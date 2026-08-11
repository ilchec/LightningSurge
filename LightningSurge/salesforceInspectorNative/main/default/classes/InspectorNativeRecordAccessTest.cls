@IsTest
private class InspectorNativeRecordAccessTest {
    @IsTest
    static void returnsFullAccessAndObjectLabelForTheRecordOwner() {
        Account acc = new Account(Name = 'Test Account');
        insert acc;

        Test.startTest();
        InspectorNativeRecordAccess.AccessResult result = InspectorNativeRecordAccess.getRecordAccess(acc.Id, UserInfo.getUserId());
        Test.stopTest();

        System.assertEquals('Account', result.objectLabel);
        System.assertEquals(true, result.hasReadAccess, 'The owner of a record always has read access to it');
        System.assert(String.isNotBlank(result.maxAccessLevel), 'MaxAccessLevel should always be populated for a visible record');
        System.assertNotEquals('None', result.maxAccessLevel);
    }

    // A deleted record's Id is still syntactically valid (Id.valueOf succeeds), but
    // UserRecordAccess reports no row for it - the same "no access" shape a genuinely
    // inaccessible-but-real record would report, without depending on this org's own sharing
    // model configuration to construct a reliable "can't see it" scenario.
    @IsTest
    static void returnsNoAccessForARecordThatNoLongerExists() {
        Account acc = new Account(Name = 'To Be Deleted');
        insert acc;
        Id deletedRecordId = acc.Id;
        delete acc;

        Test.startTest();
        InspectorNativeRecordAccess.AccessResult result = InspectorNativeRecordAccess.getRecordAccess(deletedRecordId, UserInfo.getUserId());
        Test.stopTest();

        System.assertEquals('None', result.maxAccessLevel);
        System.assertEquals(false, result.hasReadAccess);
        System.assertEquals(false, result.hasEditAccess);
        System.assertEquals(false, result.hasDeleteAccess);
        System.assertEquals(false, result.hasTransferAccess);
    }

    @IsTest
    static void throwsAFriendlyErrorForAnInvalidRecordId() {
        Boolean threw = false;
        String message;
        Test.startTest();
        try {
            InspectorNativeRecordAccess.getRecordAccess('not-a-real-id', UserInfo.getUserId());
        } catch (AuraHandledException e) {
            threw = true;
            message = e.getMessage();
        }
        Test.stopTest();

        System.assert(threw, 'An invalid record Id should surface as a thrown AuraHandledException');
    }
}
