@IsTest
private class InspectorNativeSoqlRunnerTest {
    @IsTest
    static void returnsObjectApiNameAndFieldsSortedWithIdFirst() {
        Account acc = new Account(Name = 'Test Account', Phone = '555-1234');
        insert acc;

        Test.startTest();
        InspectorNativeSoqlRunner.SoqlQueryResult result = InspectorNativeSoqlRunner.runQuery(
            'SELECT Phone, Name, Id FROM Account WHERE Id = \'' + acc.Id + '\''
        );
        Test.stopTest();

        System.assertEquals('Account', result.objectApiName, 'Should report the queried object api name');
        System.assertEquals(new List<String>{ 'Id', 'Name', 'Phone' }, result.fieldApiNames, 'Id first, rest alphabetical');
        System.assertEquals(1, result.records.size());
        System.assertEquals('Test Account', (String) result.records[0].get('Name'));
    }

    @IsTest
    static void returnsEmptyResultWithoutErrorWhenNothingMatches() {
        Test.startTest();
        InspectorNativeSoqlRunner.SoqlQueryResult result = InspectorNativeSoqlRunner.runQuery(
            'SELECT Id FROM Account WHERE Name = \'Definitely Does Not Exist 12345\''
        );
        Test.stopTest();

        System.assertEquals(null, result.objectApiName, 'No rows means no object to report');
        System.assertEquals(0, result.fieldApiNames.size());
        System.assertEquals(0, result.records.size());
    }

    @IsTest
    static void flattensParentRelationshipFieldsIntoDotPathKeys() {
        Account acc = new Account(Name = 'Parent Co', Industry = 'Technology');
        insert acc;
        Contact con = new Contact(LastName = 'Smith', AccountId = acc.Id);
        insert con;

        Test.startTest();
        InspectorNativeSoqlRunner.SoqlQueryResult result = InspectorNativeSoqlRunner.runQuery(
            'SELECT Id, LastName, Account.Name, Account.Industry FROM Contact WHERE Id = \'' + con.Id + '\''
        );
        Test.stopTest();

        System.assertEquals('Contact', result.objectApiName);
        System.assert(result.fieldApiNames.contains('Account.Name'), 'Flattened dot-path key should be reported');
        System.assert(result.fieldApiNames.contains('Account.Industry'), 'Flattened dot-path key should be reported');
        System.assertEquals('Parent Co', (String) result.records[0].get('Account.Name'));
        System.assertEquals('Technology', (String) result.records[0].get('Account.Industry'));
        System.assertEquals('Smith', (String) result.records[0].get('LastName'));
    }

    @IsTest
    static void throwsOnAnInvalidQuery() {
        Boolean threw = false;
        Test.startTest();
        try {
            InspectorNativeSoqlRunner.runQuery('SELECT NotARealField FROM Account');
        } catch (Exception e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'An invalid field/query should surface as a thrown exception, not silently succeed');
    }
}
