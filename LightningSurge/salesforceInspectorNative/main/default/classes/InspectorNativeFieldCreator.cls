/**
 * Bulk custom field creation for the Field Creator tab. The third (and, so far, last) Apex
 * exception to this app's otherwise GraphQL-only, no-Apex convention - unlike the other two (both
 * read-only: the object picker, the SOQL runner), this one WRITES to org schema, and is
 * meaningfully more sensitive as a result. A created field sticks around until someone deletes it
 * in Setup - there's no "undo" the way there is for a bad query or a bad record edit.
 *
 * Field creation is NOT reachable through the built-in Apex `Metadata` namespace
 * (Metadata.Operations/Metadata.DeployContainer) - that namespace only supports a narrow set of
 * metadata types (mainly Custom Metadata Type *records*), not arbitrary custom fields on objects.
 * The only ways to create a field from Apex are the WSDL-generated MetadataService.cls (a large,
 * separately-vendored SOAP client) or the Tooling API's CustomField REST resource, called directly
 * via HttpRequest - this class uses the latter, since it doesn't require vendoring in a
 * multi-thousand-line generated class for one feature.
 *
 * This callout targets the org's own domain (URL.getOrgDomainUrl()) - which can't be known until
 * deploy time, so it can't be pre-authorized by this package's own metadata. Deploying this
 * package requires a one-time manual Setup step: add a Remote Site Setting for the org's own My
 * Domain URL. See salesforceInspectorNative/README.md for exact instructions.
 *
 * The callout is synchronous - each field's success/failure (with the real Tooling API error
 * message on failure) is known immediately, unlike the old Metadata.Operations.enqueueDeployment
 * design this replaced, which needed the UI to poll for completion.
 *
 * Authentication is NOT UserInfo.getSessionId() - confirmed the hard way, a session obtained that
 * way from Apex invoked by a Lightning component is frequently not valid for REST/Tooling API use
 * at all (independent of org-level settings like API Allowlisting; there is no supported way to
 * obtain an API-capable session ID from Lightning). Instead this renders a tiny internal
 * Visualforce page (InspectorNativeSessionId.page, just `{!$Api.Session_ID}`) and reads the session
 * ID back via PageReference.getContent() - the well-known, if Salesforce-discouraged, workaround
 * for exactly this gap. Cached per-transaction (getApiSessionId()) so it's only rendered once
 * regardless of how many fields are being deployed in one call.
 *
 * The per-field spec type (InspectorNativeFieldSpec) is deliberately its own top-level class, not
 * nested in here - see that class's own doc comment for why (Apex inner classes aren't reliable as
 * List<T> parameter types for LWC-invoked methods, confirmed directly).
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
    public static List<FieldDeployResult> deployCustomFields(List<InspectorNativeFieldSpec> fieldSpecs) {
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
