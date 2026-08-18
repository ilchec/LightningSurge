@IsTest
private class InspectorNativeTranslationSearchTest {
    // Canned ExternalString (Custom Label) Tooling query response - Custom Label content is
    // inherently org-specific, so tests target this mock's own known shape rather than anything
    // that might or might not exist in whatever org this runs in.
    private class ExternalStringMock implements HttpCalloutMock {
        String responseBody = '{"records":[]}';

        public HttpResponse respond(HttpRequest request) {
            HttpResponse response = new HttpResponse();
            response.setStatusCode(200);
            response.setBody(responseBody);
            return response;
        }
    }

    // Bypasses the real Visualforce session-id bridge for tests - see InspectorNativeFieldCreatorTest
    // for why cachedApiSessionId is @TestVisible specifically for this.
    private static void stubApiSessionId() {
        InspectorNativeTranslationSearch.cachedApiSessionId = 'test-session-id';
    }

    @IsTest
    static void searchReturnsEmptyForBlankOrTooShortSearchTerm() {
        Test.startTest();
        List<InspectorNativeTranslationSearch.SearchResult> blankResults = InspectorNativeTranslationSearch.search(null);
        List<InspectorNativeTranslationSearch.SearchResult> shortResults = InspectorNativeTranslationSearch.search('a');
        Test.stopTest();

        System.assertEquals(0, blankResults.size());
        System.assertEquals(0, shortResults.size());
    }

    @IsTest
    static void searchNeverReturnsAStandardObjectAsAnObjectMatch() {
        stubApiSessionId();
        Test.setMock(HttpCalloutMock.class, new ExternalStringMock());

        Test.startTest();
        List<InspectorNativeTranslationSearch.SearchResult> results = InspectorNativeTranslationSearch.search('Account');
        Test.stopTest();

        for (InspectorNativeTranslationSearch.SearchResult result : results) {
            if (result.itemType == 'Object') {
                System.assert(
                    result.objectApiName.endsWithIgnoreCase('__c'),
                    'Only custom objects are translatable via Translation Workbench - a standard object should never appear as an Object match: ' + result.objectApiName
                );
            }
            if (result.itemType == 'Field') {
                System.assert(
                    result.fieldApiName.endsWithIgnoreCase('__c'),
                    'Only custom fields are translatable via Translation Workbench - a standard field should never appear as a Field match: ' + result.fieldApiName
                );
            }
        }
    }

    @IsTest
    static void searchIncludesCustomLabelMatchesFromTheToolingQuery() {
        stubApiSessionId();
        ExternalStringMock mock = new ExternalStringMock();
        mock.responseBody = '{"records":[{"Id":"01e000000000001AAA","Name":"My_Test_Label","MasterLabel":"My Test Label","Value":"Some translatable text","Category":"Test"}]}';
        Test.setMock(HttpCalloutMock.class, mock);

        // A nonsense term unlikely to also match anything in the org's own describe scan, so this
        // result is deterministically driven only by the mocked Custom Label response above.
        Test.startTest();
        List<InspectorNativeTranslationSearch.SearchResult> results = InspectorNativeTranslationSearch.search('zzzqqqnonexistentxyz123');
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals('Custom Label', results[0].itemType);
        System.assertEquals('Some translatable text', results[0].matchedText);
        System.assertEquals('01e000000000001AAA', results[0].labelId);
        System.assertEquals('My_Test_Label', results[0].labelName);
        System.assertEquals('Test', results[0].labelCategory);
    }

    // Reproduces a live bug: a label that matched via Name/MasterLabel can have a blank Value - the
    // JSON response then omits that key entirely, so row.get('Value') comes back null. The sort
    // comparator that runs over every result previously called .compareTo() directly on that null
    // matchedText and threw "Attempt to de-reference a null object" - confirmed live, fixed by
    // defaulting to '' when building the result and by making the comparator itself null-safe.
    @IsTest
    static void searchHandlesACustomLabelWithNoValueWithoutThrowing() {
        stubApiSessionId();
        ExternalStringMock mock = new ExternalStringMock();
        mock.responseBody = '{"records":[{"Id":"01e000000000001AAA","Name":"Address_Related_Label","MasterLabel":"Address Related Label","Category":"Test"}]}';
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        List<InspectorNativeTranslationSearch.SearchResult> results = InspectorNativeTranslationSearch.search('zzzqqqnonexistentxyz123');
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals('', results[0].matchedText);
        System.assertEquals('Address_Related_Label', results[0].labelName);
    }

    @IsTest
    static void searchHandlesSpecialCharactersInTheSearchTermWithoutThrowing() {
        stubApiSessionId();
        Test.setMock(HttpCalloutMock.class, new ExternalStringMock());

        Boolean threw = false;
        Test.startTest();
        try {
            InspectorNativeTranslationSearch.search('50%_off\'s "text"');
        } catch (Exception e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(!threw, 'A search term containing SOQL LIKE wildcards/quotes should be escaped, not thrown on');
    }
}
