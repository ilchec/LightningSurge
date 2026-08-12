/**
 * "What references this field/object" for the Impact Analysis tab, via the Tooling API's Dependency
 * API (MetadataComponentDependency). Read-only - no DML anywhere in this class - but still needs the
 * same Tooling API HTTP callout shape as InspectorNativeFieldCreator/InspectorNativePicklistManager
 * (own-domain HttpRequest, InspectorNativeSessionId session bridge, no Remote Site Setting needed),
 * confirmed via research before writing this: MetadataComponentDependency is not queryable through
 * plain Apex SOQL at all - it only exists via the Tooling API's own REST query endpoint. Call this
 * out plainly wherever this class's risk tier is described (README, permission set commentary) -
 * it's read-only, but not the same zero-callout risk tier as InspectorNativeOrgInfo/
 * InspectorNativeRecordAccess.
 *
 * Scoped to custom fields and custom objects only (CustomField/CustomObject Tooling objects) - same
 * reasoning as InspectorNativePicklistManager's own scope note: a standard field/object doesn't have
 * a CustomField/CustomObject record to resolve a Tooling component Id from at all, and would need a
 * different lookup (FieldDefinition/EntityDefinition, with a less consistently-documented DurableId
 * format) - a plausible future addition, not part of this pass.
 *
 * Coverage is real but incomplete, confirmed via research: capped at 2,000 dependency rows per query
 * (LIMIT applied explicitly below, so a capped result is a deliberate, visible boundary rather than a
 * silent truncation), Reports are not included at all, and Flow references are shallower than Apex/
 * formula-field references. Every result from this class should be presented as "what was found,"
 * never as an exhaustive guarantee that nothing else depends on a given field/object.
 */
public with sharing class InspectorNativeDependencyAnalysis {
    private static final String API_VERSION = '67.0';

    public class ComponentReference {
        @AuraEnabled
        public String componentName;
        @AuraEnabled
        public String componentType;
    }

    @AuraEnabled
    public static List<ComponentReference> getFieldReferences(String objectApiName, String fieldApiName) {
        String developerName = fieldApiName.endsWith('__c') ? fieldApiName.removeEnd('__c') : fieldApiName;
        String customFieldId = queryComponentId(
            'CustomField',
            'TableEnumOrId = \'' + String.escapeSingleQuotes(objectApiName) + '\' AND DeveloperName = \'' + String.escapeSingleQuotes(developerName) + '\''
        );
        if (customFieldId == null) {
            throw new AuraHandledException(
                'Could not find a custom field definition for ' + objectApiName + '.' + fieldApiName
                    + ' via the Tooling API - only custom fields are supported here.'
            );
        }
        return queryDependencies(customFieldId);
    }

    @AuraEnabled
    public static List<ComponentReference> getObjectReferences(String objectApiName) {
        String developerName = objectApiName.endsWith('__c') ? objectApiName.removeEnd('__c') : objectApiName;
        String customObjectId = queryComponentId('CustomObject', 'DeveloperName = \'' + String.escapeSingleQuotes(developerName) + '\'');
        if (customObjectId == null) {
            throw new AuraHandledException(
                'Could not find a custom object definition for ' + objectApiName + ' via the Tooling API - only custom objects are supported here.'
            );
        }
        return queryDependencies(customObjectId);
    }

    private static String queryComponentId(String toolingObjectName, String whereClause) {
        Map<String, Object> parsed = runToolingQuery('SELECT Id FROM ' + toolingObjectName + ' WHERE ' + whereClause);
        List<Object> records = (List<Object>) parsed.get('records');
        if (records == null || records.isEmpty()) {
            return null;
        }
        return (String) ((Map<String, Object>) records[0]).get('Id');
    }

    // 2,000 is the Dependency API's own documented per-query cap - applied explicitly here so a
    // capped result is a deliberate, visible boundary (the client can say "at least 2,000 shown")
    // rather than something that just happens to stop at some implicit limit.
    private static List<ComponentReference> queryDependencies(String refMetadataComponentId) {
        String soql = 'SELECT MetadataComponentName, MetadataComponentType FROM MetadataComponentDependency WHERE RefMetadataComponentId = \''
            + String.escapeSingleQuotes(refMetadataComponentId) + '\' ORDER BY MetadataComponentType, MetadataComponentName LIMIT 2000';
        Map<String, Object> parsed = runToolingQuery(soql);
        List<Object> records = (List<Object>) parsed.get('records');
        List<ComponentReference> results = new List<ComponentReference>();
        if (records != null) {
            for (Object record : records) {
                Map<String, Object> row = (Map<String, Object>) record;
                ComponentReference ref = new ComponentReference();
                ref.componentName = (String) row.get('MetadataComponentName');
                ref.componentType = (String) row.get('MetadataComponentType');
                results.add(ref);
            }
        }
        return results;
    }

    private static Map<String, Object> runToolingQuery(String soql) {
        HttpRequest request = new HttpRequest();
        request.setEndpoint(
            URL.getOrgDomainUrl().toExternalForm() + '/services/data/v' + API_VERSION + '/tooling/query/?q=' + EncodingUtil.urlEncode(soql, 'UTF-8')
        );
        request.setMethod('GET');
        request.setHeader('Authorization', 'Bearer ' + getApiSessionId());

        HttpResponse response = new Http().send(request);
        if (response.getStatusCode() != 200) {
            throw new AuraHandledException('Error querying dependency data: ' + extractErrorMessage(response.getBody()));
        }
        return (Map<String, Object>) JSON.deserializeUntyped(response.getBody());
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
