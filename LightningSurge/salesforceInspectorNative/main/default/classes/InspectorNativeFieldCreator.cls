/**
 * Bulk custom field creation for the Field Creator tab. One of this app's few Apex exceptions to
 * its otherwise GraphQL-only convention, and the only one that WRITES to org schema rather than
 * data - a created field sticks around until someone deletes it in Setup, so this is treated with
 * more care than a read-only tab (see salesforceInspectorNative/README.md's "Setting it up").
 *
 * Field creation is NOT reachable through the built-in Apex `Metadata` namespace
 * (Metadata.Operations/Metadata.DeployContainer) - that namespace only supports a narrow set of
 * metadata types (mainly Custom Metadata Type *records*), not arbitrary custom fields on objects.
 * The only ways to create a field from Apex are the WSDL-generated MetadataService.cls (a large,
 * separately-vendored SOAP client) or the Tooling API's CustomField REST resource, called directly
 * via HttpRequest - this class uses the latter, since it doesn't require vendoring in a
 * multi-thousand-line generated class for one feature.
 *
 * This callout targets the org's own domain (URL.getOrgDomainUrl()) - no Remote Site Setting is
 * needed for it, confirmed live: Salesforce doesn't require pre-authorizing a callout an org makes
 * back to its own domain.
 *
 * The callout is synchronous - each field's success/failure (with the real Tooling API error
 * message on failure) is known immediately, no polling.
 *
 * Authentication is NOT UserInfo.getSessionId() - a session obtained that way from Apex invoked by
 * a Lightning component is frequently not valid for REST/Tooling API use at all. Instead this
 * renders a tiny internal Visualforce page (InspectorNativeSessionId.page, just
 * `{!$Api.Session_ID}`) and reads the session ID back via PageReference.getContent() - the
 * well-known, if Salesforce-discouraged, workaround for exactly this gap. Cached per-transaction
 * (getApiSessionId()) so it's only rendered once regardless of how many fields are being deployed
 * in one call.
 *
 * The per-field spec type (InspectorNativeFieldSpec) is its own top-level class, not nested in here
 * - Apex inner classes aren't reliable as List<T> parameter types for LWC-invoked methods (they
 * work fine as return types). deployCustomFields itself takes a JSON string (fieldSpecsJson), not a
 * typed List<InspectorNativeFieldSpec> parameter, parsed with JSON.deserialize() inside the method -
 * the reliable way to get a list of custom-typed data into an @AuraEnabled method from this app's
 * own experience (see InspectorNativeFlsMatrix.saveFieldPermissions for the same pattern).
 */
public with sharing class InspectorNativeFieldCreator {
    private static final String API_VERSION = '67.0';
    private static final Set<String> LENGTH_TYPES = new Set<String>{ 'Text', 'LongTextArea', 'Email', 'Url' };
    private static final Set<String> PRECISION_SCALE_TYPES = new Set<String>{ 'Number', 'Currency', 'Percent' };
    // Unique/External ID are only valid on these types - matches the standard "New Field" wizard's
    // own rules, not an arbitrary restriction. Setting either on an ineligible type would just fail
    // the callout, so the eligibility check happens here rather than trusting every caller to know it.
    private static final Set<String> UNIQUE_EXTERNAL_ID_TYPES = new Set<String>{ 'Text', 'Number', 'Email' };

    public class FieldDeployResult {
        @AuraEnabled
        public String apiName;
        @AuraEnabled
        public Boolean success;
        @AuraEnabled
        public String message;
    }

    @AuraEnabled
    public static List<FieldDeployResult> deployCustomFields(String fieldSpecsJson) {
        List<InspectorNativeFieldSpec> fieldSpecs = String.isNotBlank(fieldSpecsJson)
            ? (List<InspectorNativeFieldSpec>) JSON.deserialize(fieldSpecsJson, List<InspectorNativeFieldSpec>.class)
            : new List<InspectorNativeFieldSpec>();
        List<FieldDeployResult> results = new List<FieldDeployResult>();
        for (InspectorNativeFieldSpec spec : fieldSpecs) {
            results.add(deployOneField(spec));
        }
        return results;
    }

    private static FieldDeployResult deployOneField(InspectorNativeFieldSpec spec) {
        FieldDeployResult result = new FieldDeployResult();
        result.apiName = (String.isNotBlank(spec.fieldApiName) ? spec.fieldApiName : '(missing API name)') + '__c';

        // Caught here, before attempting a callout that would otherwise fail with a confusing
        // Tooling API error - client-side validation should already prevent this, but this is the
        // actual API boundary, so it's checked again rather than trusted blindly.
        if (String.isBlank(spec.objectApiName) || String.isBlank(spec.fieldApiName) || String.isBlank(spec.label) || String.isBlank(spec.fieldType)) {
            result.success = false;
            // Temporary diagnostic (again) - the top-level-class fix didn't resolve this, so this
            // needs to stay until root-caused for real. Shows exactly what Apex parsed the whole
            // spec as.
            result.message = 'Missing required field data - nothing was sent to Salesforce. Apex received: ' + JSON.serialize(spec);
            return result;
        }

        HttpRequest request = new HttpRequest();
        request.setEndpoint(URL.getOrgDomainUrl().toExternalForm() + '/services/data/v' + API_VERSION + '/tooling/sobjects/CustomField/');
        request.setMethod('POST');
        request.setHeader('Authorization', 'Bearer ' + getApiSessionId());
        request.setHeader('Content-Type', 'application/json');
        request.setBody(JSON.serialize(buildPayload(spec)));

        HttpResponse response = new Http().send(request);
        Integer statusCode = response.getStatusCode();
        result.success = statusCode == 200 || statusCode == 201;
        if (!result.success) {
            result.message = extractErrorMessage(response.getBody());
        }
        return result;
    }

    // Cached per-transaction (deployCustomFields loops this per field, but the session only needs
    // rendering once) - see the class doc comment for why this isn't UserInfo.getSessionId().
    @TestVisible
    private static String cachedApiSessionId;

    private static String getApiSessionId() {
        if (cachedApiSessionId == null) {
            cachedApiSessionId = Page.InspectorNativeSessionId.getContent().toString().trim();
        }
        return cachedApiSessionId;
    }

    @TestVisible
    private static Map<String, Object> buildPayload(InspectorNativeFieldSpec spec) {
        Map<String, Object> metadata = new Map<String, Object>();
        metadata.put('label', spec.label);
        metadata.put('type', spec.fieldType);
        if (String.isNotBlank(spec.description)) {
            metadata.put('description', spec.description);
        }
        if (String.isNotBlank(spec.helpText)) {
            metadata.put('inlineHelpText', spec.helpText);
        }
        if (UNIQUE_EXTERNAL_ID_TYPES.contains(spec.fieldType)) {
            if (spec.isUnique == true) {
                metadata.put('unique', true);
            }
            if (spec.isExternalId == true) {
                metadata.put('externalId', true);
            }
        }

        if (LENGTH_TYPES.contains(spec.fieldType)) {
            metadata.put('length', spec.length);
        }
        if (spec.fieldType == 'LongTextArea') {
            metadata.put('visibleLines', spec.visibleLines != null ? spec.visibleLines : 3);
        }
        if (PRECISION_SCALE_TYPES.contains(spec.fieldType)) {
            metadata.put('precision', spec.precision);
            metadata.put('scale', spec.scale);
        }
        if (spec.fieldType == 'Checkbox') {
            // A Checkbox field always has a value (true/false) - it can't be "required" the way
            // other types can, and Salesforce requires an explicit default for it.
            metadata.put('defaultValue', false);
        } else {
            metadata.put('required', spec.isRequired == true);
        }
        if (spec.fieldType == 'Picklist') {
            metadata.put('picklist', buildPicklistMetadata(spec.picklistValues));
        }

        Map<String, Object> payload = new Map<String, Object>();
        payload.put('FullName', spec.objectApiName + '.' + spec.fieldApiName + '__c');
        payload.put('Metadata', metadata);
        return payload;
    }

    private static Map<String, Object> buildPicklistMetadata(List<String> picklistValues) {
        List<Map<String, Object>> picklistValueEntries = new List<Map<String, Object>>();
        for (String value : picklistValues) {
            if (String.isBlank(value)) {
                continue;
            }
            Map<String, Object> entry = new Map<String, Object>();
            entry.put('fullName', value);
            entry.put('label', value);
            entry.put('default', false);
            picklistValueEntries.add(entry);
        }
        Map<String, Object> picklist = new Map<String, Object>();
        picklist.put('picklistValues', picklistValueEntries);
        picklist.put('sorted', false);
        return picklist;
    }

    private static String extractErrorMessage(String responseBody) {
        try {
            Object parsed = JSON.deserializeUntyped(responseBody);
            if (parsed instanceof List<Object>) {
                List<Object> errors = (List<Object>) parsed;
                if (!errors.isEmpty() && errors[0] instanceof Map<String, Object>) {
                    Object message = ((Map<String, Object>) errors[0]).get('message');
                    if (message != null) {
                        return String.valueOf(message);
                    }
                }
            }
        } catch (Exception parseError) {
            // Fall through to the raw body below - still more useful than nothing.
        }
        return responseBody;
    }
}
