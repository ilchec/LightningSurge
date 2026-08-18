/**
 * "What could this text be, so I know what to pick in Translation Workbench" - a free-text lookup
 * across four match types: Custom Label, Object, Field (label or help text), and Picklist Value.
 * Read-only, no DML anywhere in this class.
 *
 * Custom Labels aren't reachable via plain Apex SOQL or any Schema describe call - the only way to
 * enumerate them dynamically is the Tooling API's ExternalString object over its REST query
 * endpoint, so this class needs the same own-domain HTTP callout shape as InspectorNativeFieldCreator/
 * InspectorNativePicklistManager/InspectorNativeDependencyAnalysis (InspectorNativeSessionId session
 * bridge, no Remote Site Setting needed) - runToolingQuery/getApiSessionId below are copied from
 * InspectorNativeDependencyAnalysis's own reference implementation. That puts this class in that
 * same callout risk tier, even though the other three match types below need no callout at all.
 *
 * Object labels, field labels/help text, and picklist values need no callout - Schema.
 * getGlobalDescribe() plus per-object/per-field describe() (including DescribeFieldResult.
 * getPicklistValues()) covers all of it in plain Apex. This mirrors InspectorNativeObjectPicker.
 * getQueryableObjects()'s own enumeration, including its EXCLUDED_SUFFIXES skip-list - copied in
 * here rather than shared, since this repo has no cross-class private Apex reuse convention.
 *
 * The Tooling API's FieldDefinition/PicklistValueInfo objects were considered and ruled out for the
 * describe-scan's job: both require an object/field filter on every query and can't be searched by
 * text across the whole org in one call - doing it that way would mean one query per object (or per
 * field, for picklist values), easily exceeding Apex's 100-SOQL-per-transaction limit in any org
 * with more than a couple hundred objects. Schema describes aren't SOQL calls, so this sidesteps
 * that limit entirely.
 *
 * Object/Field matches are scoped to custom (__c-suffixed) API names only - Translation Workbench
 * only lets you translate custom object labels and custom field labels/help text, not standard ones
 * (those are Salesforce's own shipped translations). Picklist Value matches are NOT scoped to custom
 * fields - Translation Workbench lets you translate picklist values on both standard and custom
 * fields (e.g. translating "Closed Won" on the standard Opportunity.StageName), a different scope
 * than Picklist Manager's own edit-scope (that one is about what the Tooling API can safely PATCH,
 * not what Translation Workbench can translate).
 *
 * Results are capped at 100, with the describe scan exiting as soon as the cap is hit - keeps CPU
 * time and the results list bounded, same spirit as InspectorNativeDependencyAnalysis's own explicit
 * 2,000-row cap. This is a live, synchronous scan across every custom object/field in the org on
 * every search - real but not necessarily fast in a very large org with several managed packages
 * installed, worth surfacing to the user as a caveat rather than promising instant results.
 */
public with sharing class InspectorNativeTranslationSearch {
    private static final String API_VERSION = '67.0';
    private static final Integer MAX_RESULTS = 100;

    // The describe scan alone can't know in advance how many objects/fields a given org has, so it
    // checks its own CPU usage as it goes and bails out early, leaving headroom for the Custom Label
    // Tooling API callout/JSON parsing/sort that still need to run afterward - a large org with
    // several managed packages can plausibly approach the 10-second synchronous Apex CPU limit on
    // this scan alone. Combined with the wall-clock check below (shouldStopScanning checks both).
    private static final Integer CPU_TIME_BUDGET_PERCENT = 70;

    // Wall-clock time is checked independently of CPU time - live testing showed the scan failing
    // with a fully generic, message-less "internal server error" even with every code path wrapped
    // in try/catch, which pointed away from a catchable Apex exception entirely and toward a hard
    // platform/request-level timeout: describe() calls carry real per-call overhead beyond raw CPU
    // cycles, so a large org's scan can run long in wall-clock terms well before Limits.getCpuTime()
    // alone would flag it. 5 seconds leaves real headroom under any reasonable request timeout for
    // the Custom Label callout/response afterward.
    private static final Long TIME_BUDGET_MILLIS = 5000L;
    private static Long scanStartTimeMillis;

    // Mirrors InspectorNativeObjectPicker.EXCLUDED_SUFFIXES exactly - system/internal-only object
    // suffixes that are never useful to surface as a translatable match.
    private static final Set<String> EXCLUDED_SUFFIXES = new Set<String>{
        '__History', '__Share', '__Feed', '__Tag', '__ChangeEvent', '__e', '__mdt', '__x', '__b'
    };

    public class SearchResult {
        @AuraEnabled
        public String itemType; // 'Custom Label' | 'Object' | 'Field' | 'Picklist Value'
        @AuraEnabled
        public String matchedOn; // 'Label' | 'Help Text' | 'Value' - which text actually matched
        @AuraEnabled
        public String matchedText;
        @AuraEnabled
        public String labelId; // Custom Label's own record Id - its own detail page has a per-language Override related list
        @AuraEnabled
        public String objectApiName;
        @AuraEnabled
        public String objectLabel;
        @AuraEnabled
        public String fieldApiName;
        @AuraEnabled
        public String fieldLabel;
        @AuraEnabled
        public String labelName;
        @AuraEnabled
        public String labelCategory;
    }

    // Top-level safety net: an AuraHandledException thrown deliberately further down (getApiSessionId,
    // runToolingQuery) is let through unchanged, since its message is already the useful, specific
    // one. Anything else uncaught would otherwise reach the client as an opaque "An internal server
    // error has occurred" with only an Error Id and no message - re-thrown here as an
    // AuraHandledException instead, so whatever it turns out to be is at least visible and
    // diagnosable from the tab itself rather than requiring a debug log pull.
    @AuraEnabled
    public static List<SearchResult> search(String searchTerm) {
        try {
            List<SearchResult> results = new List<SearchResult>();
            if (String.isBlank(searchTerm) || searchTerm.trim().length() < 2) {
                return results;
            }
            String term = searchTerm.trim();
            String lowerTerm = term.toLowerCase();

            addDescribeScanResults(results, lowerTerm);
            if (results.size() < MAX_RESULTS) {
                addCustomLabelResults(results, term);
            }

            results.sort(new SearchResultByTypeThenText());
            return results;
        } catch (AuraHandledException e) {
            throw e;
        } catch (Exception e) {
            throw new AuraHandledException('Unexpected error during search (' + e.getTypeName() + '): ' + e.getMessage());
        }
    }

    // Per-object and per-field processing below are each individually wrapped in a try/catch that
    // skips just that one object/field and keeps going, rather than letting a single quirky
    // managed-package object or field (schema across arbitrary orgs is heterogeneous in ways this
    // scan can't fully anticipate) take down the entire search with an uncaught exception. Missing
    // one object's or field's matches is a far better failure mode than the whole tab being unusable.
    private static void addDescribeScanResults(List<SearchResult> results, String lowerTerm) {
        scanStartTimeMillis = System.now().getTime();
        for (Schema.SObjectType sObjType : Schema.getGlobalDescribe().values()) {
            if (results.size() >= MAX_RESULTS || shouldStopScanning()) {
                return;
            }
            String objectApiName = String.valueOf(sObjType);
            if (hasExcludedSuffix(objectApiName)) {
                continue;
            }
            try {
                addObjectAndFieldMatches(results, lowerTerm, sObjType, objectApiName);
            } catch (Exception scanError) {
                continue;
            }
        }
    }

    private static void addObjectAndFieldMatches(List<SearchResult> results, String lowerTerm, Schema.SObjectType sObjType, String objectApiName) {
        Schema.DescribeSObjectResult describeResult = sObjType.getDescribe();
        if (!describeResult.isAccessible()) {
            return;
        }
        Boolean isCustomObject = objectApiName.endsWithIgnoreCase('__c');
        String objectLabel = String.valueOf(describeResult.getLabel());
        if (isCustomObject && objectLabel.toLowerCase().contains(lowerTerm)) {
            SearchResult result = new SearchResult();
            result.itemType = 'Object';
            result.matchedOn = 'Label';
            result.matchedText = objectLabel;
            result.objectApiName = objectApiName;
            result.objectLabel = objectLabel;
            results.add(result);
        }

        for (Schema.SObjectField field : describeResult.fields.getMap().values()) {
            if (results.size() >= MAX_RESULTS || shouldStopScanning()) {
                return;
            }
            try {
                Schema.DescribeFieldResult fieldDescribe = field.getDescribe();
                if (!fieldDescribe.isAccessible()) {
                    continue;
                }
                addFieldMatches(results, lowerTerm, describeResult, fieldDescribe, objectApiName);
            } catch (Exception fieldError) {
                continue;
            }
        }
    }

    private static void addFieldMatches(
        List<SearchResult> results,
        String lowerTerm,
        Schema.DescribeSObjectResult describeResult,
        Schema.DescribeFieldResult fieldDescribe,
        String objectApiName
    ) {
        Boolean isCustomField = fieldDescribe.getName().endsWithIgnoreCase('__c');
        String fieldLabel = String.valueOf(fieldDescribe.getLabel());
        if (isCustomField) {
            if (fieldLabel.toLowerCase().contains(lowerTerm)) {
                results.add(buildFieldResult('Field', 'Label', fieldLabel, describeResult, fieldDescribe, objectApiName));
            }
            String helpText = fieldDescribe.getInlineHelpText();
            if (String.isNotBlank(helpText) && helpText.toLowerCase().contains(lowerTerm)) {
                results.add(buildFieldResult('Field', 'Help Text', helpText, describeResult, fieldDescribe, objectApiName));
            }
        }

        Schema.DisplayType fieldType = fieldDescribe.getType();
        if (fieldType == Schema.DisplayType.PICKLIST || fieldType == Schema.DisplayType.MULTIPICKLIST) {
            for (Schema.PicklistEntry entry : fieldDescribe.getPicklistValues()) {
                if (results.size() >= MAX_RESULTS || shouldStopScanning()) {
                    return;
                }
                String entryLabel = String.valueOf(entry.getLabel());
                if (entryLabel.toLowerCase().contains(lowerTerm)) {
                    results.add(buildFieldResult('Picklist Value', 'Value', entryLabel, describeResult, fieldDescribe, objectApiName));
                }
            }
        }
    }

    private static SearchResult buildFieldResult(
        String itemType,
        String matchedOn,
        String matchedText,
        Schema.DescribeSObjectResult describeResult,
        Schema.DescribeFieldResult fieldDescribe,
        String objectApiName
    ) {
        SearchResult result = new SearchResult();
        result.itemType = itemType;
        result.matchedOn = matchedOn;
        result.matchedText = matchedText;
        result.objectApiName = objectApiName;
        result.objectLabel = describeResult.getLabel();
        result.fieldApiName = fieldDescribe.getName();
        result.fieldLabel = fieldDescribe.getLabel();
        return result;
    }

    private static Boolean shouldStopScanning() {
        if (Limits.getCpuTime() > (Limits.getLimitCpuTime() * CPU_TIME_BUDGET_PERCENT / 100)) {
            return true;
        }
        return (System.now().getTime() - scanStartTimeMillis) > TIME_BUDGET_MILLIS;
    }

    private static Boolean hasExcludedSuffix(String apiName) {
        for (String suffix : EXCLUDED_SUFFIXES) {
            if (apiName.endsWithIgnoreCase(suffix)) {
                return true;
            }
        }
        return false;
    }

    private static void addCustomLabelResults(List<SearchResult> results, String term) {
        String likeTerm = '\'%' + escapeLikeValue(term) + '%\'';
        String soql = 'SELECT Id, Name, MasterLabel, Value, Category FROM ExternalString WHERE (Value LIKE '
            + likeTerm + ' OR MasterLabel LIKE ' + likeTerm + ' OR Name LIKE ' + likeTerm + ') LIMIT '
            + (MAX_RESULTS - results.size());
        Map<String, Object> parsed = runToolingQuery(soql);
        List<Object> records = (List<Object>) parsed.get('records');
        if (records == null) {
            return;
        }
        for (Object record : records) {
            Map<String, Object> row = (Map<String, Object>) record;
            SearchResult result = new SearchResult();
            result.itemType = 'Custom Label';
            result.matchedOn = 'Value';
            // A label can match via Name/MasterLabel while its own Value is blank/absent from the
            // JSON response entirely - default to '' rather than leaving this null, since it flows
            // straight into a sort comparison below.
            result.matchedText = (String) row.get('Value') ?? '';
            result.labelId = (String) row.get('Id');
            result.labelName = (String) row.get('Name') ?? '';
            result.labelCategory = (String) row.get('Category') ?? '';
            results.add(result);
        }
    }

    // Backslash first, then the two LIKE wildcards, then the quote that closes the literal - same
    // escaping order Data Masking's own SOQL-filter escaping already established for user-typed
    // text landing in a LIKE clause.
    private static String escapeLikeValue(String value) {
        return value.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_').replace('\'', '\\\'');
    }

    // Everything in here - the callout itself and the JSON parsing - is wrapped so any failure
    // surfaces as a clear, descriptive AuraHandledException rather than an uncaught
    // CalloutException/JSONException. An uncaught exception here reaches the client as an opaque
    // "An internal server error has occurred" with only an Error Id, no message - not enough to
    // diagnose from a bug report - whereas AuraHandledException's message is shown verbatim.
    private static Map<String, Object> runToolingQuery(String soql) {
        HttpRequest request = new HttpRequest();
        request.setEndpoint(
            URL.getOrgDomainUrl().toExternalForm() + '/services/data/v' + API_VERSION + '/tooling/query/?q=' + EncodingUtil.urlEncode(soql, 'UTF-8')
        );
        request.setMethod('GET');
        request.setHeader('Authorization', 'Bearer ' + getApiSessionId());

        HttpResponse response;
        try {
            response = new Http().send(request);
        } catch (Exception calloutError) {
            throw new AuraHandledException('Error calling the Tooling API for Custom Label search: ' + calloutError.getMessage());
        }
        if (response.getStatusCode() != 200) {
            throw new AuraHandledException('Error searching Custom Labels (status ' + response.getStatusCode() + '): ' + extractErrorMessage(response.getBody()));
        }
        try {
            return (Map<String, Object>) JSON.deserializeUntyped(response.getBody());
        } catch (Exception parseError) {
            throw new AuraHandledException('Error parsing the Custom Label search response: ' + parseError.getMessage());
        }
    }

    // Cached per-transaction - see InspectorNativeFieldCreator's doc comment for why this isn't
    // UserInfo.getSessionId().
    @TestVisible
    private static String cachedApiSessionId;

    private static String getApiSessionId() {
        if (cachedApiSessionId == null) {
            Blob content = Page.InspectorNativeSessionId.getContent();
            if (content == null) {
                throw new AuraHandledException('Could not read the internal session bridge page (InspectorNativeSessionId) needed for the Custom Label search.');
            }
            cachedApiSessionId = content.toString().trim();
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

    // Defensively null-safe (blank-defaulted, not just non-throwing) even though every result-
    // building path above now guarantees non-null itemType/matchedText - a sort comparator running
    // over every result is the last place a stray null anywhere upstream would surface, and the
    // cost of a defensive check here is negligible next to the cost of a live NPE.
    private class SearchResultByTypeThenText implements Comparator<SearchResult> {
        public Integer compare(SearchResult a, SearchResult b) {
            Integer typeComparison = String.valueOf(a.itemType).compareTo(String.valueOf(b.itemType));
            if (typeComparison != 0) {
                return typeComparison;
            }
            return String.valueOf(a.matchedText).compareTo(String.valueOf(b.matchedText));
        }
    }
}
