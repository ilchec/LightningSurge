/**
 * Runs a user-typed SOQL query for the Query Records tab. The second (and, so far, last) Apex
 * exception to this app's otherwise GraphQL-only, no-Apex convention - arbitrary SOQL execution
 * isn't reachable client-side at all.
 *
 * Security: Database.query(soql, AccessLevel.USER_MODE) enforces the running user's own CRUD/
 * FLS/sharing on the query (the modern, Salesforce-recommended replacement for WITH
 * SECURITY_ENFORCED) - this method can only ever see what the calling user could already see
 * through any other query tool (Data Loader, Workbench, Developer Console). Database.query only
 * ever executes a SELECT; there's no way to reach DML through this method, so "no Apex DML
 * anywhere in this app" still holds even with this exception.
 *
 * No LIMIT is injected into the caller's SOQL - it does exactly what was typed. Row-count capping
 * for the grid happens client-side (inspectorNativeQueryRecords truncates to this app's
 * usual maxRows).
 */
public with sharing class InspectorNativeSoqlRunner {
    public class SoqlQueryResult {
        @AuraEnabled
        public String objectApiName;
        @AuraEnabled
        public List<String> fieldApiNames;
        @AuraEnabled
        public List<Map<String, Object>> records;
    }

    @AuraEnabled
    public static SoqlQueryResult runQuery(String soql) {
        List<SObject> queryResults = Database.query(soql, AccessLevel.USER_MODE);

        SoqlQueryResult result = new SoqlQueryResult();
        result.records = new List<Map<String, Object>>();
        Set<String> fieldNameSet = new Set<String>();
        for (SObject record : queryResults) {
            Map<String, Object> fields = flattenRecord(record);
            fieldNameSet.addAll(fields.keySet());
            result.records.add(fields);
        }
        if (!queryResults.isEmpty()) {
            result.objectApiName = queryResults[0].getSObjectType().getDescribe().getName();
        }
        result.fieldApiNames = sortFieldNamesIdFirst(fieldNameSet);
        return result;
    }

    // Relationship traversal (e.g. "SELECT Id, Account.Name FROM Contact"): getPopulatedFieldsAsMap()
    // returns a parent relationship (e.g. "Account") as a nested SObject rather than a flat
    // "Account.Name" key - this walks that nesting and flattens it into dot-path keys instead, to
    // arbitrary depth (e.g. "Account.Owner.Name"), so the client can treat every populated field the
    // same way regardless of whether it came from the base object or a traversed relationship. A
    // child-relationship subquery (e.g. "(SELECT Id FROM Contacts)") surfaces as a List rather than an
    // SObject and is skipped entirely - a list of records can't flatten into one scalar column, and
    // this app's grid only ever renders one row per top-level queried record anyway.
    private static Map<String, Object> flattenRecord(SObject record) {
        Map<String, Object> flat = new Map<String, Object>();
        Map<String, Object> populated = record.getPopulatedFieldsAsMap();
        for (String fieldName : populated.keySet()) {
            Object value = populated.get(fieldName);
            if (value instanceof SObject) {
                Map<String, Object> nested = flattenRecord((SObject) value);
                for (String nestedFieldName : nested.keySet()) {
                    flat.put(fieldName + '.' + nestedFieldName, nested.get(nestedFieldName));
                }
            } else if (!(value instanceof List<Object>)) {
                flat.put(fieldName, value);
            }
        }
        return flat;
    }

    // Apex Map/Set iteration order isn't guaranteed to match the SELECT clause's written order,
    // so this doesn't try to preserve it - alphabetical, with Id pinned first, is deterministic
    // and good enough (the grid's column order is a secondary concern to what data is shown).
    private static List<String> sortFieldNamesIdFirst(Set<String> fieldNameSet) {
        List<String> fieldNames = new List<String>(fieldNameSet);
        fieldNames.sort();
        Integer idIndex = fieldNames.indexOf('Id');
        if (idIndex > 0) {
            fieldNames.remove(idIndex);
            fieldNames.add(0, 'Id');
        }
        return fieldNames;
    }
}
