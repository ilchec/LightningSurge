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
 */
public with sharing class InspectorNativeFieldCreator {
    private static final String API_VERSION = '67.0';
    private static final Set<String> LENGTH_TYPES = new Set<String>{ 'Text', 'LongTextArea', 'Email', 'Url' };
    private static final Set<String> PRECISION_SCALE_TYPES = new Set<String>{ 'Number', 'Currency', 'Percent' };
    // Unique/External ID are only valid on these types - matches the standard "New Field" wizard's
    // own rules, not an arbitrary restriction. Setting either on an ineligible type would just fail
    // the callout, so the eligibility check happens here rather than trusting every caller to know it.
    private static final Set<String> UNIQUE_EXTERNAL_ID_TYPES = new Set<String>{ 'Text', 'Number', 'Email' };

    public class FieldSpec {
        @AuraEnabled
        public String objectApiName;
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String apiName; // without the __c suffix - appended in buildFullName
        @AuraEnabled
        public String fieldType; // one of Text/LongTextArea/Checkbox/Number/Currency/Percent/Date/DateTime/Email/Phone/Url/Picklist
        @AuraEnabled
        public Integer length;
        @AuraEnabled
        public Integer precision;
        @AuraEnabled
        public Integer scale;
        @AuraEnabled
        public Integer visibleLines;
        @AuraEnabled
        public Boolean isRequired;
        @AuraEnabled
        public String description;
        @AuraEnabled
        public String helpText;
        @AuraEnabled
        public Boolean isUnique;
        @AuraEnabled
        public Boolean isExternalId;
        @AuraEnabled
        public List<String> picklistValues;
    }

    public class FieldDeployResult {
        @AuraEnabled
        public String apiName;
        @AuraEnabled
        public Boolean success;
        @AuraEnabled
        public String message;
    }

    @AuraEnabled
    public static List<FieldDeployResult> deployFields(List<FieldSpec> fieldSpecs) {
        List<FieldDeployResult> results = new List<FieldDeployResult>();
        for (FieldSpec spec : fieldSpecs) {
            results.add(deployOneField(spec));
        }
        return results;
    }

    private static FieldDeployResult deployOneField(FieldSpec spec) {
        FieldDeployResult result = new FieldDeployResult();
        result.apiName = spec.apiName + '__c';

        HttpRequest request = new HttpRequest();
        request.setEndpoint(URL.getOrgDomainUrl().toExternalForm() + '/services/data/v' + API_VERSION + '/tooling/sobjects/CustomField/');
        request.setMethod('POST');
        request.setHeader('Authorization', 'Bearer ' + UserInfo.getSessionId());
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

    @TestVisible
    private static Map<String, Object> buildPayload(FieldSpec spec) {
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
        payload.put('FullName', spec.objectApiName + '.' + spec.apiName + '__c');
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
