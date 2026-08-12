@IsTest
private class InspectorNativePicklistManagerTest {
    // Dispatches on method/endpoint shape rather than one fixed response, since a single
    // getPicklistValues/savePicklistValues call makes up to two real callouts in sequence (resolve
    // the CustomField Id via a Tooling query, then GET/PATCH its full metadata) - the standard,
    // supported way to test Apex HTTP callouts without a real network call.
    private class DispatchingMock implements HttpCalloutMock {
        String queryResponseBody = '{"records":[{"Id":"00N000000000001AAA"}]}';
        String metadataGetResponseBody;
        Integer patchStatusCode = 204;
        String patchResponseBody = '';

        public HttpResponse respond(HttpRequest request) {
            HttpResponse response = new HttpResponse();
            if (request.getEndpoint().contains('/tooling/query/')) {
                response.setStatusCode(200);
                response.setBody(queryResponseBody);
            } else if (request.getMethod() == 'PATCH') {
                response.setStatusCode(patchStatusCode);
                response.setBody(patchResponseBody);
            } else {
                response.setStatusCode(200);
                response.setBody(metadataGetResponseBody);
            }
            return response;
        }
    }

    // "valueName" (not "fullName") is the confirmed-live real key for a value-set entry's own
    // identifying value - see the class doc comment for the full story of how "fullName" (the
    // Metadata API create-payload key name) turned out to be the wrong assumption for a GET
    // response's actual JSON wire format.
    private static String metadataWithValues() {
        return '{"Metadata":{"label":"My Picklist","type":"Picklist","valueSet":{"valueSetDefinition":{"sorted":false,"value":['
            + '{"valueName":"Open","label":"Open","default":true,"isActive":true},'
            + '{"valueName":"Closed","label":"Closed","default":false,"isActive":false}'
            + ']}}}}';
    }

    private static String metadataWithGlobalValueSet() {
        return '{"Metadata":{"label":"My Picklist","type":"Picklist","valueSet":{"valueSetName":"SomeGlobalValueSet","restricted":true}}}';
    }

    // Bypasses the real Visualforce session-id bridge for tests - see InspectorNativeFieldCreatorTest
    // for why cachedApiSessionId is @TestVisible specifically for this.
    private static void stubApiSessionId() {
        InspectorNativePicklistManager.cachedApiSessionId = 'test-session-id';
    }

    @IsTest
    static void getPicklistValuesReturnsActiveAndInactiveValuesWithTheirCustomFieldId() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.metadataGetResponseBody = metadataWithValues();
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        InspectorNativePicklistManager.PicklistValuesResult result = InspectorNativePicklistManager.getPicklistValues('Account', 'My_Picklist__c');
        Test.stopTest();

        System.assertEquals('00N000000000001AAA', result.customFieldId);
        System.assertEquals(2, result.values.size());
        System.assertEquals('Open', result.values[0].value);
        System.assertEquals(true, result.values[0].isActive);
        System.assertEquals(true, result.values[0].isDefault);
        System.assertEquals('Closed', result.values[1].value);
        System.assertEquals(false, result.values[1].isActive);
    }

    // Confirmed live: a real org's value entries can come back with "isActive": null rather than an
    // explicit true/false (matches CustomValue's own documented default - "the default value is
    // true" - evidently expressed as an absent/null value rather than a literal true). This should
    // still read as active, not fail closed.
    @IsTest
    static void getPicklistValuesTreatsANullIsActiveAsActive() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.metadataGetResponseBody =
            '{"Metadata":{"label":"My Picklist","type":"Picklist","valueSet":{"valueSetDefinition":{"sorted":false,"value":['
                + '{"valueName":"Gold","label":"Gold","default":false,"isActive":null}'
                + ']}}}}';
        Test.setMock(HttpCalloutMock.class, mock);

        Test.startTest();
        InspectorNativePicklistManager.PicklistValuesResult result = InspectorNativePicklistManager.getPicklistValues('Account', 'My_Picklist__c');
        Test.stopTest();

        System.assertEquals('Gold', result.values[0].value);
        System.assertEquals(true, result.values[0].isActive);
    }

    @IsTest
    static void getPicklistValuesThrowsWhenNoMatchingCustomFieldIsFound() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.queryResponseBody = '{"records":[]}';
        Test.setMock(HttpCalloutMock.class, mock);

        Boolean threw = false;
        Test.startTest();
        try {
            InspectorNativePicklistManager.getPicklistValues('Account', 'Nonexistent_Field__c');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'Should throw when the Tooling query finds no matching CustomField');
    }

    @IsTest
    static void getPicklistValuesThrowsForAFieldOnAGlobalValueSet() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.metadataGetResponseBody = metadataWithGlobalValueSet();
        Test.setMock(HttpCalloutMock.class, mock);

        Boolean threw = false;
        String message;
        Test.startTest();
        try {
            InspectorNativePicklistManager.getPicklistValues('Account', 'My_Picklist__c');
        } catch (AuraHandledException e) {
            threw = true;
            message = e.getMessage();
        }
        Test.stopTest();

        System.assert(threw, 'A field built on a shared Global Value Set should be rejected, not mis-parsed');
        System.assert(message.contains('Global Value Set'), 'Actual message: ' + message);
    }

    @IsTest
    static void savePicklistValuesSucceedsWhenTheCalloutSucceeds() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.metadataGetResponseBody = metadataWithValues();
        Test.setMock(HttpCalloutMock.class, mock);

        InspectorNativePicklistManager.PicklistValueOption newValue = new InspectorNativePicklistManager.PicklistValueOption();
        newValue.value = 'Escalated';
        newValue.label = 'Escalated';
        newValue.isActive = true;

        Test.startTest();
        InspectorNativePicklistManager.SaveResult result = InspectorNativePicklistManager.savePicklistValues(
            '00N000000000001AAA',
            JSON.serialize(new List<InspectorNativePicklistManager.PicklistValueOption>{ newValue })
        );
        Test.stopTest();

        System.assertEquals(true, result.success);
    }

    @IsTest
    static void savePicklistValuesReportsTheRealErrorMessageWhenTheCalloutFails() {
        stubApiSessionId();
        DispatchingMock mock = new DispatchingMock();
        mock.metadataGetResponseBody = metadataWithValues();
        mock.patchStatusCode = 400;
        mock.patchResponseBody = '[{"message":"INVALID_FIELD: value set entry is invalid","errorCode":"INVALID_FIELD"}]';
        Test.setMock(HttpCalloutMock.class, mock);

        InspectorNativePicklistManager.PicklistValueOption newValue = new InspectorNativePicklistManager.PicklistValueOption();
        newValue.value = 'Escalated';

        Test.startTest();
        InspectorNativePicklistManager.SaveResult result = InspectorNativePicklistManager.savePicklistValues(
            '00N000000000001AAA',
            JSON.serialize(new List<InspectorNativePicklistManager.PicklistValueOption>{ newValue })
        );
        Test.stopTest();

        System.assertEquals(false, result.success);
        System.assertEquals('INVALID_FIELD: value set entry is invalid', result.message);
    }

    @IsTest
    static void savePicklistValuesThrowsWhenCustomFieldIdIsBlank() {
        stubApiSessionId();
        // No mock set - if this incorrectly attempted a callout, the test would fail with
        // System.CalloutException: Callout not allowed, proving the guard actually short-circuits.
        Boolean threw = false;
        Test.startTest();
        try {
            InspectorNativePicklistManager.savePicklistValues(null, JSON.serialize(new List<InspectorNativePicklistManager.PicklistValueOption>()));
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'A blank customFieldId should be rejected before attempting a callout');
    }

    @IsTest
    static void buildValueEntriesSkipsBlankValuesAndDefaultsIsActiveToTrue() {
        InspectorNativePicklistManager.PicklistValueOption blank = new InspectorNativePicklistManager.PicklistValueOption();
        blank.value = '';

        InspectorNativePicklistManager.PicklistValueOption noActiveFlagSet = new InspectorNativePicklistManager.PicklistValueOption();
        noActiveFlagSet.value = 'New_Value';
        // isActive left null on purpose - should still come out true (opt-in-to-inactive, not
        // opt-in-to-active, matches how a freshly added value should behave).

        List<Map<String, Object>> entries = InspectorNativePicklistManager.buildValueEntries(
            new List<InspectorNativePicklistManager.PicklistValueOption>{ blank, noActiveFlagSet }
        );

        System.assertEquals(1, entries.size(), 'The blank-value entry should be skipped');
        System.assertEquals('New_Value', entries[0].get('valueName'));
        System.assertEquals(true, entries[0].get('isActive'));
        System.assertEquals(false, entries[0].get('default'));
    }
}
