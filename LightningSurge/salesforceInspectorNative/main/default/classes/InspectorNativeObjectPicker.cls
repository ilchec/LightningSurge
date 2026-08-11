/**
 * Read-only object lists for the Salesforce Inspector Native app's object pickers. Reliably
 * enumerating every object the running user can see, with labels, isn't achievable client-side (it
 * needs Schema.getGlobalDescribe()), so these narrow, read-only, cacheable methods are a deliberate
 * exception to the rest of the repo's GraphQL-only, no-Apex convention.
 */
public with sharing class InspectorNativeObjectPicker {
    // System/internal-only object suffixes that are never useful to offer in a "create records"
    // picker - filtered out before the (comparatively expensive) per-object describe() call below,
    // not after, to keep a cold cacheable call cheap even in orgs with many packages installed.
    private static final Set<String> EXCLUDED_SUFFIXES = new Set<String>{
        '__History', '__Share', '__Feed', '__Tag', '__ChangeEvent', '__e', '__mdt', '__x', '__b'
    };

    public class ObjectOption {
        @AuraEnabled
        public String apiName;
        @AuraEnabled
        public String label;

        public ObjectOption(String apiName, String label) {
            this.apiName = apiName;
            this.label = label;
        }
    }

    @AuraEnabled(cacheable=true)
    public static List<ObjectOption> getCreatableObjects() {
        List<ObjectOption> options = new List<ObjectOption>();
        for (Schema.SObjectType sObjType : Schema.getGlobalDescribe().values()) {
            String apiName = String.valueOf(sObjType);
            if (hasExcludedSuffix(apiName)) {
                continue;
            }
            Schema.DescribeSObjectResult describeResult = sObjType.getDescribe();
            if (describeResult.isCreateable() && describeResult.isQueryable() && !describeResult.isCustomSetting()) {
                options.add(new ObjectOption(apiName, describeResult.getLabel()));
            }
        }
        options.sort(new ObjectOptionByLabel());
        return options;
    }

    // Schema Explorer, Relationship Map, Data Export, and the FLS Matrix editor are all read-
    // oriented (or, for FLS, govern access rather than create records) - scoping them to
    // isCreateable() the way getCreatableObjects() does would wrongly hide plenty of legitimate,
    // read-only or admin-managed objects. isQueryable() is the right bar for "can this app do
    // anything useful with this object at all".
    @AuraEnabled(cacheable=true)
    public static List<ObjectOption> getQueryableObjects() {
        List<ObjectOption> options = new List<ObjectOption>();
        for (Schema.SObjectType sObjType : Schema.getGlobalDescribe().values()) {
            String apiName = String.valueOf(sObjType);
            if (hasExcludedSuffix(apiName)) {
                continue;
            }
            Schema.DescribeSObjectResult describeResult = sObjType.getDescribe();
            if (describeResult.isQueryable() && !describeResult.isCustomSetting()) {
                options.add(new ObjectOption(apiName, describeResult.getLabel()));
            }
        }
        options.sort(new ObjectOptionByLabel());
        return options;
    }

    private static Boolean hasExcludedSuffix(String apiName) {
        for (String suffix : EXCLUDED_SUFFIXES) {
            if (apiName.endsWithIgnoreCase(suffix)) {
                return true;
            }
        }
        return false;
    }

    private class ObjectOptionByLabel implements Comparator<ObjectOption> {
        public Integer compare(ObjectOption a, ObjectOption b) {
            return a.label.compareTo(b.label);
        }
    }
}
