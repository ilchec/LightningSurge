@IsTest
private class InspectorNativeFlsMatrixTest {
    @IsTest
    static void getFieldPermissionMatrixReturnsPermissionableFieldsAndExistingGrants() {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_Fls_Matrix_Set', Label = 'Test FLS Matrix Set');
        insert permissionSet;
        insert new FieldPermissions(
            ParentId = permissionSet.Id,
            SobjectType = 'Account',
            Field = 'Account.Phone',
            PermissionsRead = true,
            PermissionsEdit = false
        );

        Test.startTest();
        InspectorNativeFlsMatrix.FlsMatrixResult result = InspectorNativeFlsMatrix.getFieldPermissionMatrix('Account');
        Test.stopTest();

        Boolean foundPhoneField = false;
        for (InspectorNativeFlsMatrix.FieldOption option : result.fields) {
            System.assert(String.isNotBlank(option.apiName), 'Every field option should have an apiName');
            System.assert(String.isNotBlank(option.label), 'Every field option should have a label');
            if (option.apiName == 'Phone') {
                foundPhoneField = true;
            }
        }
        System.assert(foundPhoneField, 'Phone is a permissionable standard field and should be offered');

        Boolean foundPermissionSet = false;
        for (InspectorNativeFieldPermissions.PermissionSetOption option : result.permissionSets) {
            if (option.id == permissionSet.Id) {
                foundPermissionSet = true;
            }
        }
        System.assert(foundPermissionSet, 'The permission set created above should be listed');

        Boolean foundExistingGrant = false;
        for (InspectorNativeFlsMatrix.FlsGrantState grant : result.existingGrants) {
            if (grant.permissionSetId == permissionSet.Id && grant.fieldApiName == 'Phone') {
                foundExistingGrant = true;
                System.assertEquals(true, grant.readAccess);
                System.assertEquals(false, grant.editAccess);
            }
        }
        System.assert(foundExistingGrant, 'The existing Phone grant should be reported, keyed by plain field apiName');
    }

    @IsTest
    static void getFieldPermissionMatrixThrowsForAnUnknownObject() {
        Boolean threw = false;
        Test.startTest();
        try {
            InspectorNativeFlsMatrix.getFieldPermissionMatrix('Definitely_Not_A_Real_Object__x');
        } catch (AuraHandledException e) {
            threw = true;
        }
        Test.stopTest();

        System.assert(threw, 'An unknown object api name should surface as a thrown exception');
    }

    @IsTest
    static void saveFieldPermissionsCreatesANewGrant() {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_Fls_Save_Set1', Label = 'Test FLS Save Set 1');
        insert permissionSet;

        InspectorNativeFlsGrant grant = new InspectorNativeFlsGrant();
        grant.fieldApiName = 'Test_Field__c';
        grant.permissionSetId = permissionSet.Id;
        grant.readAccess = true;
        grant.editAccess = false;

        Test.startTest();
        InspectorNativeFlsMatrix.saveFieldPermissions('Account', new List<InspectorNativeFlsGrant>{ grant });
        Test.stopTest();

        FieldPermissions created = [
            SELECT PermissionsRead, PermissionsEdit
            FROM FieldPermissions
            WHERE ParentId = :permissionSet.Id AND SobjectType = 'Account' AND Field = 'Account.Test_Field__c'
        ];
        System.assertEquals(true, created.PermissionsRead);
        System.assertEquals(false, created.PermissionsEdit);
    }

    @IsTest
    static void saveFieldPermissionsUpdatesAnExistingGrant() {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_Fls_Save_Set2', Label = 'Test FLS Save Set 2');
        insert permissionSet;
        insert new FieldPermissions(
            ParentId = permissionSet.Id,
            SobjectType = 'Account',
            Field = 'Account.Test_Field2__c',
            PermissionsRead = true,
            PermissionsEdit = false
        );

        InspectorNativeFlsGrant grant = new InspectorNativeFlsGrant();
        grant.fieldApiName = 'Test_Field2__c';
        grant.permissionSetId = permissionSet.Id;
        grant.readAccess = false;
        grant.editAccess = true;

        Test.startTest();
        InspectorNativeFlsMatrix.saveFieldPermissions('Account', new List<InspectorNativeFlsGrant>{ grant });
        Test.stopTest();

        List<FieldPermissions> updated = [
            SELECT PermissionsRead, PermissionsEdit
            FROM FieldPermissions
            WHERE ParentId = :permissionSet.Id AND SobjectType = 'Account' AND Field = 'Account.Test_Field2__c'
        ];
        System.assertEquals(1, updated.size(), 'The existing row should be updated in place, not duplicated');
        System.assertEquals(true, updated[0].PermissionsRead, 'Edit access should imply read access');
        System.assertEquals(true, updated[0].PermissionsEdit);
    }

    @IsTest
    static void saveFieldPermissionsDeletesAnExistingGrantWhenBothUnchecked() {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_Fls_Save_Set3', Label = 'Test FLS Save Set 3');
        insert permissionSet;
        insert new FieldPermissions(
            ParentId = permissionSet.Id,
            SobjectType = 'Account',
            Field = 'Account.Test_Field3__c',
            PermissionsRead = true,
            PermissionsEdit = true
        );

        InspectorNativeFlsGrant grant = new InspectorNativeFlsGrant();
        grant.fieldApiName = 'Test_Field3__c';
        grant.permissionSetId = permissionSet.Id;
        grant.readAccess = false;
        grant.editAccess = false;

        Test.startTest();
        InspectorNativeFlsMatrix.saveFieldPermissions('Account', new List<InspectorNativeFlsGrant>{ grant });
        Test.stopTest();

        List<FieldPermissions> remaining = [
            SELECT Id
            FROM FieldPermissions
            WHERE ParentId = :permissionSet.Id AND SobjectType = 'Account' AND Field = 'Account.Test_Field3__c'
        ];
        System.assertEquals(0, remaining.size(), 'Unchecking both boxes should remove the grant entirely, unlike the additive-only Field Creator flow');
    }

    @IsTest
    static void saveFieldPermissionsIsANoOpWhenGivenNoGrants() {
        Test.startTest();
        InspectorNativeFlsMatrix.saveFieldPermissions('Account', new List<InspectorNativeFlsGrant>());
        Test.stopTest();
        // No exception thrown is the assertion here - nothing to query, there was nothing to do.
    }
}
