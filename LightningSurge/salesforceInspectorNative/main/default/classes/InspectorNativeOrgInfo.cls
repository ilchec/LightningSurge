/**
 * Read-only org-level usage info for the Limits and Licenses tab: license consumption (mirrors
 * Company Information's own User Licenses / Permission Set Licenses sections) and org limits
 * (mirrors Salesforce Inspector Reloaded's Limits page). Both are plain, standard Apex - UserLicense
 * and PermissionSetLicense are normal queryable objects, and System.OrgLimits.getMap() is the
 * standard Apex-native way to read org limits - no SOQL, no callout, nothing sensitive to gate
 * behind an extra permission the way field/permission writes are.
 *
 * Neither method is cacheable, unlike the other read-only Apex in this app - usage numbers exist
 * specifically to show *current* state, and an @AuraEnabled(cacheable=true) wire could otherwise
 * show a stale count from earlier in the session. Both tabs call their method imperatively and
 * offer an explicit Refresh action instead.
 */
public with sharing class InspectorNativeOrgInfo {
    public class LicenseUsage {
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String type; // 'UserLicense' | 'PermissionSetLicense'
        @AuraEnabled
        public Integer used;
        @AuraEnabled
        public Integer total;
        @AuraEnabled
        public String status;
    }

    // TotalLicenses > 0 filters out license types this org isn't provisioned for at all - same
    // "don't show N/A rows" filtering Company Information's own licensing section applies.
    @AuraEnabled
    public static List<LicenseUsage> getLicenseUsage() {
        List<LicenseUsage> usages = new List<LicenseUsage>();
        for (UserLicense license : [SELECT MasterLabel, UsedLicenses, TotalLicenses, Status FROM UserLicense WHERE TotalLicenses > 0]) {
            usages.add(buildLicenseUsage(license.MasterLabel, 'UserLicense', license.UsedLicenses, license.TotalLicenses, license.Status));
        }
        for (PermissionSetLicense license : [
            SELECT MasterLabel, UsedLicenses, TotalLicenses, Status
            FROM PermissionSetLicense
            WHERE TotalLicenses > 0
        ]) {
            usages.add(buildLicenseUsage(license.MasterLabel, 'PermissionSetLicense', license.UsedLicenses, license.TotalLicenses, license.Status));
        }
        usages.sort(new LicenseUsageByUsageDesc());
        return usages;
    }

    private static LicenseUsage buildLicenseUsage(String label, String type, Integer used, Integer total, String status) {
        LicenseUsage usage = new LicenseUsage();
        usage.label = label;
        usage.type = type;
        usage.used = used;
        usage.total = total;
        usage.status = status;
        return usage;
    }

    private class LicenseUsageByUsageDesc implements Comparator<LicenseUsage> {
        public Integer compare(LicenseUsage a, LicenseUsage b) {
            // Cross-multiplied rather than dividing, so this never has to worry about integer
            // division truncating two different usages down to the same rounded percentage.
            Long left = (Long) b.used * a.total;
            Long right = (Long) a.used * b.total;
            return left > right ? 1 : (left < right ? -1 : 0);
        }
    }

    public class OrgLimitUsage {
        @AuraEnabled
        public String name;
        @AuraEnabled
        public Integer used;
        @AuraEnabled
        public Integer max;
    }

    // getLimit() == 0 means this limit doesn't apply to the org at all (e.g. a Bulk API limit in an
    // org without that feature) - excluded the same way the zero-license rows above are, rather than
    // showing a meaningless "0 / 0" gauge.
    @AuraEnabled
    public static List<OrgLimitUsage> getOrgLimits() {
        List<OrgLimitUsage> usages = new List<OrgLimitUsage>();
        Map<String, System.OrgLimit> limitsByName = OrgLimits.getMap();
        for (String name : limitsByName.keySet()) {
            System.OrgLimit orgLimit = limitsByName.get(name);
            if (orgLimit.getLimit() == 0) {
                continue;
            }
            OrgLimitUsage usage = new OrgLimitUsage();
            usage.name = name;
            usage.used = orgLimit.getValue();
            usage.max = orgLimit.getLimit();
            usages.add(usage);
        }
        usages.sort(new OrgLimitUsageByUsageDesc());
        return usages;
    }

    private class OrgLimitUsageByUsageDesc implements Comparator<OrgLimitUsage> {
        public Integer compare(OrgLimitUsage a, OrgLimitUsage b) {
            Long left = (Long) b.used * a.max;
            Long right = (Long) a.used * b.max;
            return left > right ? 1 : (left < right ? -1 : 0);
        }
    }
}
