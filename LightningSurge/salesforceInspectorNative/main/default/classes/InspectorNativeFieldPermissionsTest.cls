@IsTest
private class InspectorNativeFieldPermissionsTest {
    @IsTest
    static void returnsPermissionSetOptionsWithIdAndLabel() {
        Test.startTest();
        List<InspectorNativeFieldPermissions.PermissionSetOption> options = InspectorNativeFieldPermissions.getAssignablePermissionSets();
        Test.stopTest();

        // A fresh scratch org isn't guaranteed to have any non-profile-owned permission sets, so
        // this only asserts the shape is correct for whatever comes back, not a minimum count.
        for (InspectorNativeFieldPermissions.PermissionSetOption option : options) {
            System.assert(String.isNotBlank(option.id), 'Every option should have an id');
            System.assert(String.isNotBlank(option.label), 'Every option should have a label');
        }
    }

    @IsTest
    static void grantsReadAndEditAccessOnANewFieldPermissionRecord() {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_Field_Perm_Set', Label = 'Test Field Perm Set');
        insert permissionSet;

        InspectorNativeFieldPermissions.FieldPermissionGrant grant = new InspectorNativeFieldPermissions.FieldPermissionGrant();
        grant.permissionSetId = permissionSet.Id;
        grant.readAccess = true;
        grant.editAccess = true;

        Test.startTest();
        InspectorNativeFieldPermissions.grantFieldPermissions(
            'Account',
            'Test_Perm_Field__c',
            new List<InspectorNativeFieldPermissions.FieldPermissionGrant>{ grant }
        );
        Test.stopTest();

        FieldPermissions created = [
            SELECT PermissionsRead, PermissionsEdit
            FROM FieldPermissions
            WHERE ParentId = :permissionSet.Id AND SobjectType = 'Account' AND Field = 'Account.Test_Perm_Field__c'
        ];
        System.assertEquals(true, created.PermissionsRead);
        System.assertEquals(true, created.PermissionsEdit);
    }

    @IsTest
    static void editAccessImpliesReadAccessEvenIfReadWasNotExplicitlyChecked() {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_Field_Perm_Set2', Label = 'Test Field Perm Set 2');
        insert permissionSet;

        InspectorNativeFieldPermissions.FieldPermissionGrant grant = new InspectorNativeFieldPermissions.FieldPermissionGrant();
        grant.permissionSetId = permissionSet.Id;
        grant.readAccess = false;
        grant.editAccess = true;

        Test.startTest();
        InspectorNativeFieldPermissions.grantFieldPermissions(
            'Account',
            'Test_Perm_Field2__c',
            new List<InspectorNativeFieldPermissions.FieldPermissionGrant>{ grant }
        );
        Test.stopTest();

        FieldPermissions created = [
            SELECT PermissionsRead, PermissionsEdit
            FROM FieldPermissions
            WHERE ParentId = :permissionSet.Id AND SobjectType = 'Account' AND Field = 'Account.Test_Perm_Field2__c'
        ];
        System.assertEquals(true, created.PermissionsRead, 'Edit access should imply read access');
        System.assertEquals(true, created.PermissionsEdit);
    }

    @IsTest
    static void skipsGrantsWithNeitherReadNorEditChecked() {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_Field_Perm_Set3', Label = 'Test Field Perm Set 3');
        insert permissionSet;

        InspectorNativeFieldPermissions.FieldPermissionGrant grant = new InspectorNativeFieldPermissions.FieldPermissionGrant();
        grant.permissionSetId = permissionSet.Id;
        grant.readAccess = false;
        grant.editAccess = false;

        Test.startTest();
        InspectorNativeFieldPermissions.grantFieldPermissions(
            'Account',
            'Test_Perm_Field3__c',
            new List<InspectorNativeFieldPermissions.FieldPermissionGrant>{ grant }
        );
        Test.stopTest();

        List<FieldPermissions> created = [
            SELECT Id
            FROM FieldPermissions
            WHERE ParentId = :permissionSet.Id AND SobjectType = 'Account' AND Field = 'Account.Test_Perm_Field3__c'
        ];
        System.assertEquals(0, created.size(), 'Nothing should be created when neither box is checked');
    }
}
