@IsTest
private class InspectorNativeObjectPickerTest {
    @IsTest
    static void returnsASortedNonEmptyListIncludingAKnownStandardObject() {
        Test.startTest();
        List<InspectorNativeObjectPicker.ObjectOption> options =
            InspectorNativeObjectPicker.getCreatableObjects();
        Test.stopTest();

        System.assert(!options.isEmpty(), 'Expected at least one creatable object to be returned');

        Boolean foundAccount = false;
        for (InspectorNativeObjectPicker.ObjectOption option : options) {
            System.assert(String.isNotBlank(option.apiName), 'Every option should have an apiName');
            System.assert(String.isNotBlank(option.label), 'Every option should have a label');
            if (option.apiName == 'Account') {
                foundAccount = true;
            }
        }
        System.assert(foundAccount, 'Account is creatable/queryable in every org and should be in the list');

        for (Integer i = 1; i < options.size(); i++) {
            System.assert(
                options.get(i - 1).label.compareTo(options.get(i).label) <= 0,
                'Options should be sorted by label'
            );
        }
    }

    @IsTest
    static void excludesObjectsWithFilteredSuffixesAndNonCreateableObjects() {
        List<InspectorNativeObjectPicker.ObjectOption> options =
            InspectorNativeObjectPicker.getCreatableObjects();

        for (InspectorNativeObjectPicker.ObjectOption option : options) {
            System.assert(!option.apiName.endsWith('__History'), 'History objects should be filtered out: ' + option.apiName);
            System.assert(!option.apiName.endsWith('__Share'), 'Share objects should be filtered out: ' + option.apiName);
            System.assert(!option.apiName.endsWith('__Feed'), 'Feed objects should be filtered out: ' + option.apiName);
        }

        Boolean foundAccountHistory = false;
        for (InspectorNativeObjectPicker.ObjectOption option : options) {
            if (option.apiName == 'AccountHistory') {
                foundAccountHistory = true;
            }
        }
        System.assert(!foundAccountHistory, 'AccountHistory is not creatable and should not appear');
    }

    @IsTest
    static void queryableListIsBroaderThanCreatableList() {
        Test.startTest();
        List<InspectorNativeObjectPicker.ObjectOption> queryableOptions = InspectorNativeObjectPicker.getQueryableObjects();
        List<InspectorNativeObjectPicker.ObjectOption> createableOptions = InspectorNativeObjectPicker.getCreatableObjects();
        Test.stopTest();

        System.assert(!queryableOptions.isEmpty(), 'Expected at least one queryable object to be returned');
        System.assert(
            queryableOptions.size() >= createableOptions.size(),
            'Every createable object is also queryable, so this list should never be smaller'
        );

        Boolean foundAccount = false;
        for (InspectorNativeObjectPicker.ObjectOption option : queryableOptions) {
            if (option.apiName == 'Account') {
                foundAccount = true;
            }
        }
        System.assert(foundAccount, 'Account should be in the queryable list');
    }
}
