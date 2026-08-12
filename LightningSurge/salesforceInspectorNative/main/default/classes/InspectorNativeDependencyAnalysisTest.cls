@IsTest
private class InspectorNativeDependencyAnalysisTest {
    // Dispatches on the query text rather than a fixed response, since a single
    // getFieldReferences/getObjectReferences call makes two sequential Tooling queries (resolve the
    // CustomField/CustomObject Id, then query MetadataComponentDependency against it) - the
    // standard, supported way to test Apex HTTP callouts without a real network call.
    private class DispatchingMock implements HttpCalloutMock {
        String componentIdQueryResponseBody = '{"records":[{"Id":"00N000000000001AAA"}]}';
        String dependencyQueryResponseBody =
            '{"records":[{"MetadataComponentName":"MyFlow","MetadataComponentType":"Flow"},{"MetadataComponentName":"MyApexClass","MetadataComponentType":"ApexClass"}]}';

        public HttpResponse respond(HttpRequest request) {
            HttpResponse response = new HttpResponse();
            response.setStatusCode(200);
            String query = EncodingUtil.urlDecode(request.getEndpoint().substringAfter('?q='), 'UTF-8');
            response.setBody(query.contains('MetadataComponentDependency') ? dependencyQueryResponseBody : componentIdQueryResponseBody);
            return response;
        }
    }

    // Bypasses the real Visualforce session-id bridge for tests - see InspectorNativeFieldCreatorTest
    // for why cachedApiSessionId is @TestVisible specifically for this.
    private static void stubApiSessionId() {
        InspectorNativeDependencyAnalysis.cachedApiSessionId = 'test-session-id';
    }

    @IsTest
    static void getFieldReferencesReturnsEveryReferencingComponent() {
        stubApiSessionId();
        Test.setMock(HttpCalloutMock.class, new DispatchingMock());

        Test.startTest();
        List<InspectorNativeDependencyAnalysis.ComponentReference> results = InspectorNativeDependencyAnalysis.getFieldReferences(
            'Account',
            'My_Field__c'
        );
        Test.stopTest();

        System.assertEquals(2, results.size());
        System.assertEquals('MyFlow', results[0].componentName);
        System.assertEquals('Flow', results[0].componentType);
        System.assertEquals('MyApexClass', results[1].componentName);
        System.assertEquals('ApexClass', results[1].componentType);
    }

    @IsTest
    static void getFieldReferencesThrowsWhenTheFieldIsNotACustomField() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.componentIdQueryResponseBody = '{"records":[]}';
        Test.setMock(HttpCalloutMock.class, mock);

        Boolean threw = false;
        Test.startTest();
        try {
            InspectorNativeDependencyAnalysis.getFieldReferences('Account', 'Industry');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'A standard field (no CustomField record) should be rejected with a clear error, not mis-parsed');
    }

    @IsTest
    static void getObjectReferencesReturnsEveryReferencingComponent() {
        stubApiSessionId();
        Test.setMock(HttpCalloutMock.class, new DispatchingMock());

        Test.startTest();
        List<InspectorNativeDependencyAnalysis.ComponentReference> results = InspectorNativeDependencyAnalysis.getObjectReferences('My_Object__c');
        Test.stopTest();

        System.assertEquals(2, results.size());
    }

    @IsTest
    static void getObjectReferencesThrowsWhenTheObjectIsNotACustomObject() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.componentIdQueryResponseBody = '{"records":[]}';
        Test.setMock(HttpCalloutMock.class, mock);

        Boolean threw = false;
        Test.startTest();
        try {
            InspectorNativeDependencyAnalysis.getObjectReferences('Account');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'A standard object (no CustomObject record) should be rejected with a clear error, not mis-parsed');
    }

    @IsTest
    static void returnsAnEmptyListWhenNothingReferencesTheComponent() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.dependencyQueryResponseBody = '{"records":[]}';
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        List<InspectorNativeDependencyAnalysis.ComponentReference> results = InspectorNativeDependencyAnalysis.getFieldReferences(
            'Account',
            'My_Field__c'
        );
        Test.stopTest();

        System.assertEquals(0, results.size());
    }
}
