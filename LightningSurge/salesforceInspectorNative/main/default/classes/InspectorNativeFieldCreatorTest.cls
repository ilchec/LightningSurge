@IsTest
private class InspectorNativeFieldCreatorTest {
    // buildPayload is @TestVisible and asserted on directly for the type-specific mapping logic
    // (the interesting part); deployCustomFields/the actual callout is exercised separately via
    // HttpCalloutMock, since that's the standard, supported way to test Apex HTTP callouts without
    // a real network call.

    private class SuccessMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest request) {
            HttpResponse response = new HttpResponse();
            response.setStatusCode(201);
            response.setBody('{"id":"00N000000000001AAA","success":true,"errors":[]}');
            return response;
        }
    }

    private class FailureMock implements HttpCalloutMock {
        public HttpResponse respond(HttpRequest request) {
            HttpResponse response = new HttpResponse();
            response.setStatusCode(400);
            response.setBody('[{"message":"Field name is not valid","errorCode":"INVALID_FIELD"}]');
            return response;
        }
    }

    // Bypasses the real Visualforce session-id bridge (Page.InspectorNativeSessionId.getContent())
    // for tests - cachedApiSessionId is @TestVisible specifically so tests don't depend on
    // $Api.Session_ID's behavior in a test context, which isn't guaranteed to match production.
    private static void stubApiSessionId() {
        InspectorNativeFieldCreator.cachedApiSessionId = 'test-session-id';
    }

    @IsTest
    static void deploysFieldsSuccessfullyWhenTheCalloutSucceeds() {
        stubApiSessionId();
        Test.setMock(HttpCalloutMock.class, new SuccessMock());
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'My_Field';
        spec.label = 'My Field';
        spec.fieldType = 'Text';
        spec.length = 100;

        Test.startTest();
        List<InspectorNativeFieldCreator.FieldDeployResult> results = InspectorNativeFieldCreator.deployCustomFields(
            new List<InspectorNativeFieldSpec>{ spec }
        );
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals('My_Field__c', results[0].apiName);
        System.assertEquals(true, results[0].success);
    }

    @IsTest
    static void reportsTheRealErrorMessageWhenTheCalloutFails() {
        stubApiSessionId();
        Test.setMock(HttpCalloutMock.class, new FailureMock());
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'Bad_Field';
        spec.label = 'Bad Field';
        spec.fieldType = 'Text';
        spec.length = 100;

        Test.startTest();
        List<InspectorNativeFieldCreator.FieldDeployResult> results = InspectorNativeFieldCreator.deployCustomFields(
            new List<InspectorNativeFieldSpec>{ spec }
        );
        Test.stopTest();

        System.assertEquals(false, results[0].success);
        System.assertEquals('Field name is not valid', results[0].message);
    }

    @IsTest
    static void reportsAClearErrorInsteadOfAttemptingACalloutWhenRequiredFieldDataIsMissing() {
        stubApiSessionId();
        // No mock set - if this incorrectly attempted a callout, the test would fail with
        // System.CalloutException: Callout not allowed, proving the guard actually short-circuits.
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = null;
        spec.label = 'My Field';
        spec.fieldType = 'Text';

        Test.startTest();
        List<InspectorNativeFieldCreator.FieldDeployResult> results = InspectorNativeFieldCreator.deployCustomFields(
            new List<InspectorNativeFieldSpec>{ spec }
        );
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(false, results[0].success);
        System.assertEquals('(missing API name)__c', results[0].apiName);
        System.assert(results[0].message.contains('Missing required field data'), 'Actual message: ' + results[0].message);
    }

    @IsTest
    static void buildsAPayloadWithFullNameAndBasicMetadataForATextField() {
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'My_Field';
        spec.label = 'My Field';
        spec.fieldType = 'Text';
        spec.length = 100;
        spec.isRequired = true;

        Map<String, Object> payload = InspectorNativeFieldCreator.buildPayload(spec);

        System.assertEquals('Account.My_Field__c', payload.get('FullName'));
        Map<String, Object> metadata = (Map<String, Object>) payload.get('Metadata');
        System.assertEquals('My Field', metadata.get('label'));
        System.assertEquals('Text', metadata.get('type'));
        System.assertEquals(100, metadata.get('length'));
        System.assertEquals(true, metadata.get('required'));
    }

    @IsTest
    static void buildsAPayloadWithPrecisionAndScaleForANumberField() {
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'My_Number';
        spec.label = 'My Number';
        spec.fieldType = 'Number';
        spec.precision = 18;
        spec.scale = 2;

        Map<String, Object> payload = InspectorNativeFieldCreator.buildPayload(spec);
        Map<String, Object> metadata = (Map<String, Object>) payload.get('Metadata');

        System.assertEquals(18, metadata.get('precision'));
        System.assertEquals(2, metadata.get('scale'));
    }

    @IsTest
    static void buildsALongTextAreaFieldWithLengthAndDefaultVisibleLines() {
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'My_Notes';
        spec.label = 'My Notes';
        spec.fieldType = 'LongTextArea';
        spec.length = 32768;

        Map<String, Object> payload = InspectorNativeFieldCreator.buildPayload(spec);
        Map<String, Object> metadata = (Map<String, Object>) payload.get('Metadata');

        System.assertEquals(32768, metadata.get('length'));
        System.assertEquals(3, metadata.get('visibleLines'), 'Should default visibleLines when not given');
    }

    @IsTest
    static void checkboxFieldsIgnoreRequiredAndGetADefaultValue() {
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'My_Checkbox';
        spec.label = 'My Checkbox';
        spec.fieldType = 'Checkbox';
        spec.isRequired = true; // should be ignored - a Checkbox can't be required

        Map<String, Object> payload = InspectorNativeFieldCreator.buildPayload(spec);
        Map<String, Object> metadata = (Map<String, Object>) payload.get('Metadata');

        System.assertEquals(null, metadata.get('required'));
        System.assertEquals(false, metadata.get('defaultValue'));
    }

    @IsTest
    static void buildsAPicklistFieldWithPicklistValuesSkippingBlankOnes() {
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'My_Picklist';
        spec.label = 'My Picklist';
        spec.fieldType = 'Picklist';
        spec.picklistValues = new List<String>{ 'Open', '', 'Closed', null };

        Map<String, Object> payload = InspectorNativeFieldCreator.buildPayload(spec);
        Map<String, Object> metadata = (Map<String, Object>) payload.get('Metadata');
        Map<String, Object> picklist = (Map<String, Object>) metadata.get('picklist');
        List<Object> picklistValues = (List<Object>) picklist.get('picklistValues');

        System.assertEquals(2, picklistValues.size(), 'Blank/null values should be skipped');
        Map<String, Object> firstValue = (Map<String, Object>) picklistValues[0];
        System.assertEquals('Open', firstValue.get('fullName'));
    }

    @IsTest
    static void plainTypesLikeDateGetNoTypeSpecificFields() {
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'My_Date';
        spec.label = 'My Date';
        spec.fieldType = 'Date';

        Map<String, Object> payload = InspectorNativeFieldCreator.buildPayload(spec);
        Map<String, Object> metadata = (Map<String, Object>) payload.get('Metadata');

        System.assertEquals(null, metadata.get('length'));
        System.assertEquals(null, metadata.get('precision'));
        System.assertEquals(null, metadata.get('picklist'));
    }

    @IsTest
    static void includesHelpTextWhenGiven() {
        InspectorNativeFieldSpec spec = new InspectorNativeFieldSpec();
        spec.objectApiName = 'Account';
        spec.fieldApiName = 'My_Field';
        spec.label = 'My Field';
        spec.fieldType = 'Text';
        spec.length = 100;
        spec.helpText = 'Explains what this field is for';

        Map<String, Object> payload = InspectorNativeFieldCreator.buildPayload(spec);
        Map<String, Object> metadata = (Map<String, Object>) payload.get('Metadata');

        System.assertEquals('Explains what this field is for', metadata.get('inlineHelpText'));
    }

    @IsTest
    static void allowsUniqueAndExternalIdOnlyOnEligibleTypes() {
        InspectorNativeFieldSpec textSpec = new InspectorNativeFieldSpec();
        textSpec.objectApiName = 'Account';
        textSpec.fieldApiName = 'My_Field';
        textSpec.label = 'My Field';
        textSpec.fieldType = 'Text';
        textSpec.length = 100;
        textSpec.isUnique = true;
        textSpec.isExternalId = true;

        Map<String, Object> textMetadata = (Map<String, Object>) InspectorNativeFieldCreator.buildPayload(textSpec).get('Metadata');
        System.assertEquals(true, textMetadata.get('unique'));
        System.assertEquals(true, textMetadata.get('externalId'));

        InspectorNativeFieldSpec dateSpec = new InspectorNativeFieldSpec();
        dateSpec.objectApiName = 'Account';
        dateSpec.fieldApiName = 'My_Date';
        dateSpec.label = 'My Date';
        dateSpec.fieldType = 'Date';
        dateSpec.isUnique = true;
        dateSpec.isExternalId = true;

        Map<String, Object> dateMetadata = (Map<String, Object>) InspectorNativeFieldCreator.buildPayload(dateSpec).get('Metadata');
        System.assertEquals(null, dateMetadata.get('unique'), 'Date does not support unique - should be silently dropped, not sent');
        System.assertEquals(null, dateMetadata.get('externalId'));
    }
}
