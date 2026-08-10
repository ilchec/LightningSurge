@IsTest
private class InspectorNativeOrgInfoTest {
    @IsTest
    static void getLicenseUsageOnlyReturnsProvisionedLicensesSortedByUsageDesc() {
        Test.startTest();
        List<InspectorNativeOrgInfo.LicenseUsage> usages = InspectorNativeOrgInfo.getLicenseUsage();
        Test.stopTest();

        // A fresh scratch org isn't guaranteed to have any particular license, but every org has at
        // least one provisioned UserLicense (the running user has to have come from somewhere).
        System.assert(!usages.isEmpty(), 'Every org has at least one provisioned user license');

        Decimal previousPct = null;
        for (InspectorNativeOrgInfo.LicenseUsage usage : usages) {
            System.assert(String.isNotBlank(usage.label), 'Every row should have a label');
            System.assert(usage.type == 'UserLicense' || usage.type == 'PermissionSetLicense', 'Unexpected type: ' + usage.type);
            System.assert(usage.total > 0, 'Zero-total licenses should have been filtered out');
            Decimal pct = usage.total == 0 ? 0 : Decimal.valueOf(usage.used) / usage.total;
            if (previousPct != null) {
                System.assert(previousPct >= pct, 'Rows should be sorted by usage percentage, descending');
            }
            previousPct = pct;
        }
    }

    @IsTest
    static void getOrgLimitsExcludesZeroLimitEntriesAndSortsByUsageDesc() {
        Test.startTest();
        List<InspectorNativeOrgInfo.OrgLimitUsage> usages = InspectorNativeOrgInfo.getOrgLimits();
        Test.stopTest();

        System.assert(!usages.isEmpty(), 'A real org always has a non-empty set of applicable limits');

        Decimal previousPct = null;
        for (InspectorNativeOrgInfo.OrgLimitUsage usage : usages) {
            System.assert(String.isNotBlank(usage.name), 'Every row should have a name');
            System.assert(usage.max > 0, 'Zero-limit entries should have been filtered out');
            Decimal pct = Decimal.valueOf(usage.used) / usage.max;
            if (previousPct != null) {
                System.assert(previousPct >= pct, 'Rows should be sorted by usage percentage, descending');
            }
            previousPct = pct;
        }
    }
}
