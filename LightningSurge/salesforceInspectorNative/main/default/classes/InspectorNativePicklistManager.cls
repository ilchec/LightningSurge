/**
 * View, add, activate/deactivate, and reorder values on a custom picklist field's own value set -
 * for the Picklist Manager tab. Same Tooling API callout shape as InspectorNativeFieldCreator
 * (own-domain HttpRequest, InspectorNativeSessionId session bridge, no Remote Site Setting needed) -
 * see that class's doc comment for why a callout is required at all and why this isn't
 * UserInfo.getSessionId(). Reordering has no server-side concept of its own - the client sends the
 * complete value list in whatever order it should end up in, same as every other edit here (see
 * below), so an in-place list reorder is just one more shape of "the complete desired list".
 *
 * Scoped to custom picklist fields only (CustomField Tooling object) - a standard field's picklist,
 * or a custom field built on a shared Global Value Set (Metadata.valueSet.valueSetName populated
 * instead of an inline valueSetDefinition), lives in a differently-shaped GlobalValueSet/
 * StandardValueSet Tooling object; both surface as a clear AuraHandledException here rather than a
 * confusing parse failure, and are a plausible future addition, not part of this pass.
 *
 * Each value-set entry's own identifying key is "valueName" - confirmed live, the hard way: the
 * Metadata API's documented CustomValue type (used when *creating* a field, e.g.
 * InspectorNativeFieldCreator's own picklist payload) uses "fullName" for this, and that name was
 * assumed here too at first, based on that documentation. A live report showed every row's Value/
 * Label rendering blank while Active/Default correctly reflected real per-row data - proving
 * "isActive"/"default" were the right keys but "fullName"/"label" weren't - and a temporary
 * diagnostic (since removed) that echoed the raw JSON of a real value entry back to the tab showed
 * the real key: {"valueName":"Gold","urls":null,"label":"Gold","isActive":null,"description":null,
 * "default":false,"color":null}. The Tooling API's own JSON wire format for a CustomField's inline
 * value set genuinely differs from the Metadata API's create-payload field names - not the same
 * schema reused both ways, as originally assumed.
 *
 * The Tooling API only supports overwriting a CustomField's *entire* Metadata definition, confirmed
 * via research before writing this (a partial PATCH - e.g. sending only the changed value set - is
 * not supported) - so saving re-fetches the full, current Metadata first, replaces only its
 * valueSetDefinition.value array with the caller's complete desired list, and PATCHes the whole
 * thing back. That's also why the caller sends the *complete* desired value list (existing values
 * plus edits plus any newly added ones), not a diff - simpler, and there's no merge logic that could
 * silently drop something.
 *
 * A value's "default" flag is read and round-tripped as-is, but not editable through this tool -
 * changing which value is the default is a separate, more consequential action (existing records
 * with no explicit value would start defaulting differently) than what this tool is for.
 */
public with sharing class InspectorNativePicklistManager {
    private static final String API_VERSION = '67.0';

    public class PicklistValueOption {
        @AuraEnabled
        public String value;
        @AuraEnabled
        public String label;
        @AuraEnabled
        public Boolean isActive;
        @AuraEnabled
        public Boolean isDefault;
    }

    public class PicklistValuesResult {
        @AuraEnabled
        public String customFieldId;
        @AuraEnabled
        public List<PicklistValueOption> values;
    }

    public class SaveResult {
        @AuraEnabled
        public Boolean success;
        @AuraEnabled
        public String message;
    }

    @AuraEnabled
    public static PicklistValuesResult getPicklistValues(String objectApiName, String fieldApiName) {
        String developerName = fieldApiName.endsWith('__c') ? fieldApiName.removeEnd('__c') : fieldApiName;
        String customFieldId = queryCustomFieldId(objectApiName, developerName);
        if (customFieldId == null) {
            throw new AuraHandledException(
                'Could not find a custom field definition for ' + objectApiName + '.' + fieldApiName + ' via the Tooling API.'
            );
        }
        return buildPicklistValuesResult(customFieldId);
    }

    // valuesJson is a plain String, not a typed List<PicklistValueOption> parameter, parsed with
    // JSON.deserialize() inside the method - the reliable way this app has found to get a list of
    // custom-typed data into an @AuraEnabled method (see InspectorNativeFlsMatrix.saveFieldPermissions
    // for the fuller story of why).
    @AuraEnabled
    public static SaveResult savePicklistValues(String customFieldId, String valuesJson) {
        if (String.isBlank(customFieldId)) {
            throw new AuraHandledException('Missing customFieldId - nothing to save against.');
        }
        List<PicklistValueOption> values = String.isNotBlank(valuesJson)
            ? (List<PicklistValueOption>) JSON.deserialize(valuesJson, List<PicklistValueOption>.class)
            : new List<PicklistValueOption>();

        Map<String, Object> fullMetadata = fetchFullMetadata(customFieldId);
        Map<String, Object> valueSetDefinition = extractValueSetDefinitionOrThrow(fullMetadata);
        valueSetDefinition.put('value', buildValueEntries(values));

        HttpRequest request = new HttpRequest();
        request.setEndpoint(toolingEndpoint('/sobjects/CustomField/' + customFieldId));
        request.setMethod('PATCH');
        request.setHeader('Authorization', 'Bearer ' + getApiSessionId());
        request.setHeader('Content-Type', 'application/json');
        request.setBody(JSON.serialize(new Map<String, Object>{ 'Metadata' => fullMetadata }));

        HttpResponse response = new Http().send(request);
        Integer statusCode = response.getStatusCode();
        SaveResult result = new SaveResult();
        // A Tooling API PATCH returns 204 (No Content) on success, standard REST PATCH semantics -
        // 200 accepted too in case that ever differs by field/version.
        result.success = statusCode == 200 || statusCode == 204;
        if (!result.success) {
            result.message = extractErrorMessage(response.getBody());
        }
        return result;
    }

    private static String toolingEndpoint(String path) {
        return URL.getOrgDomainUrl().toExternalForm() + '/services/data/v' + API_VERSION + '/tooling' + path;
    }

    private static String queryCustomFieldId(String objectApiName, String developerName) {
        String soql = 'SELECT Id FROM CustomField WHERE TableEnumOrId = \''
            + String.escapeSingleQuotes(objectApiName) + '\' AND DeveloperName = \'' + String.escapeSingleQuotes(developerName) + '\'';

        HttpRequest request = new HttpRequest();
        request.setEndpoint(toolingEndpoint('/query/?q=' + EncodingUtil.urlEncode(soql, 'UTF-8')));
        request.setMethod('GET');
        request.setHeader('Authorization', 'Bearer ' + getApiSessionId());

        HttpResponse response = new Http().send(request);
        if (response.getStatusCode() != 200) {
            throw new AuraHandledException('Error looking up field metadata: ' + extractErrorMessage(response.getBody()));
        }
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(response.getBody());
        List<Object> records = (List<Object>) parsed.get('records');
        if (records == null || records.isEmpty()) {
            return null;
        }
        return (String) ((Map<String, Object>) records[0]).get('Id');
    }

    private static Map<String, Object> fetchFullMetadata(String customFieldId) {
        HttpRequest request = new HttpRequest();
        request.setEndpoint(toolingEndpoint('/sobjects/CustomField/' + customFieldId));
        request.setMethod('GET');
        request.setHeader('Authorization', 'Bearer ' + getApiSessionId());

        HttpResponse response = new Http().send(request);
        if (response.getStatusCode() != 200) {
            throw new AuraHandledException('Error reading field metadata: ' + extractErrorMessage(response.getBody()));
        }
        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(response.getBody());
        return (Map<String, Object>) parsed.get('Metadata');
    }

    private static PicklistValuesResult buildPicklistValuesResult(String customFieldId) {
        Map<String, Object> metadata = fetchFullMetadata(customFieldId);
        Map<String, Object> valueSetDefinition = extractValueSetDefinitionOrThrow(metadata);
        List<Object> rawValues = (List<Object>) valueSetDefinition.get('value');

        PicklistValuesResult result = new PicklistValuesResult();
        result.customFieldId = customFieldId;
        result.values = new List<PicklistValueOption>();
        if (rawValues != null) {
            for (Object rawValue : rawValues) {
                Map<String, Object> entry = (Map<String, Object>) rawValue;
                PicklistValueOption option = new PicklistValueOption();
                option.value = (String) entry.get('valueName');
                option.label = entry.get('label') != null ? (String) entry.get('label') : option.value;
                option.isActive = entry.get('isActive') != null ? (Boolean) entry.get('isActive') : true;
                option.isDefault = entry.get('default') == true;
                result.values.add(option);
            }
        }
        return result;
    }

    // Throws (rather than returning null/empty) the moment it's clear this field isn't a plain,
    // locally-defined picklist - a Global Value Set reference (valueSetName populated instead of an
    // inline valueSetDefinition) needs a different Tooling object entirely (GlobalValueSet), out of
    // scope here. Surfacing this clearly beats a confusing null-pointer failure deeper in.
    private static Map<String, Object> extractValueSetDefinitionOrThrow(Map<String, Object> metadata) {
        Map<String, Object> valueSet = metadata != null ? (Map<String, Object>) metadata.get('valueSet') : null;
        Object valueSetDefinition = valueSet != null ? valueSet.get('valueSetDefinition') : null;
        if (valueSetDefinition == null) {
            throw new AuraHandledException('This field uses a shared picklist value set (a Global Value Set) - not editable here.');
        }
        return (Map<String, Object>) valueSetDefinition;
    }

    // Writes the same "valueName" key the GET response was confirmed live to use (see the class doc
    // comment) - inferred by symmetry, not independently re-confirmed for the write direction, since
    // PATCHing this whole Metadata blob back is exactly reusing the shape GET just returned with one
    // field swapped out (see savePicklistValues) rather than building a request body from scratch.
    @TestVisible
    private static List<Map<String, Object>> buildValueEntries(List<PicklistValueOption> values) {
        List<Map<String, Object>> entries = new List<Map<String, Object>>();
        for (PicklistValueOption value : values) {
            if (String.isBlank(value.value)) {
                continue;
            }
            Map<String, Object> entry = new Map<String, Object>();
            entry.put('valueName', value.value);
            entry.put('label', String.isNotBlank(value.label) ? value.label : value.value);
            entry.put('default', value.isDefault == true);
            entry.put('isActive', value.isActive != false);
            entries.add(entry);
        }
        return entries;
    }

    // Cached per-transaction - see InspectorNativeFieldCreator's doc comment for why this isn't
    // UserInfo.getSessionId().
    @TestVisible
    private static String cachedApiSessionId;

    private static String getApiSessionId() {
        if (cachedApiSessionId == null) {
            cachedApiSessionId = Page.InspectorNativeSessionId.getContent().toString().trim();
        }
        return cachedApiSessionId;
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
