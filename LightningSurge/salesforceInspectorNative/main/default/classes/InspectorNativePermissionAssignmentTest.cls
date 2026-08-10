@IsTest
private class InspectorNativePermissionAssignmentTest {
    private static PermissionSet createTestPermissionSet(String suffix) {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_Perm_Assign_' + suffix, Label = 'Test Perm Assign ' + suffix);
        insert permissionSet;
        return permissionSet;
    }

    private static PermissionSetGroup createTestPermissionSetGroup(String suffix) {
        PermissionSetGroup permissionSetGroup = new PermissionSetGroup(DeveloperName = 'Test_PSG_' + suffix, MasterLabel = 'Test PSG ' + suffix);
        insert permissionSetGroup;
        return permissionSetGroup;
    }

    private static Group createTestPublicGroup(String suffix) {
        Group publicGroup = new Group(Name = 'Test Public Group ' + suffix, DeveloperName = 'Test_Public_Group_' + suffix, Type = 'Regular');
        insert publicGroup;
        return publicGroup;
    }

    private static User createTestUser(String suffix) {
        Profile standardProfile = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        String uniqueSuffix = suffix + String.valueOf(System.currentTimeMillis());
        User user = new User(
            FirstName = 'Test',
            LastName = 'PermAssign' + suffix,
            Email = 'test.permassign.' + uniqueSuffix + '@example.com.invalid',
            Username = 'test.permassign.' + uniqueSuffix + '@example.com.invalid',
            Alias = 'tpa' + suffix.left(3),
            TimeZoneSidKey = 'America/Los_Angeles',
            LocaleSidKey = 'en_US',
            EmailEncodingKey = 'UTF-8',
            LanguageLocaleKey = 'en_US',
            ProfileId = standardProfile.Id
        );
        insert user;
        return user;
    }

    @IsTest
    static void getAssignableItemsReturnsAllThreeTypes() {
        PermissionSet permissionSet = createTestPermissionSet('Items1');
        PermissionSetGroup permissionSetGroup = createTestPermissionSetGroup('Items1');
        Group publicGroup = createTestPublicGroup('Items1');

        Test.startTest();
        List<InspectorNativePermissionAssignment.AssignableItem> items = InspectorNativePermissionAssignment.getAssignableItems();
        Test.stopTest();

        Map<Id, InspectorNativePermissionAssignment.AssignableItem> itemById = new Map<Id, InspectorNativePermissionAssignment.AssignableItem>();
        for (InspectorNativePermissionAssignment.AssignableItem item : items) {
            itemById.put(item.id, item);
        }
        System.assertEquals('PermissionSet', itemById.get(permissionSet.Id).type);
        System.assertEquals('PermissionSetGroup', itemById.get(permissionSetGroup.Id).type);
        System.assertEquals('PublicGroup', itemById.get(publicGroup.Id).type);
    }

    @IsTest
    static void searchUsersReturnsEmptyForBlankOrTooShortTerm() {
        Test.startTest();
        System.assertEquals(0, InspectorNativePermissionAssignment.searchUsers(null).size());
        System.assertEquals(0, InspectorNativePermissionAssignment.searchUsers('').size());
        System.assertEquals(0, InspectorNativePermissionAssignment.searchUsers('a').size());
        Test.stopTest();
    }

    @IsTest
    static void searchUsersMatchesOnName() {
        User user = createTestUser('Zzzsearch');

        Test.startTest();
        List<InspectorNativePermissionAssignment.UserOption> results = InspectorNativePermissionAssignment.searchUsers('Zzzsearch');
        Test.stopTest();

        Boolean found = false;
        for (InspectorNativePermissionAssignment.UserOption option : results) {
            if (option.id == user.Id) {
                found = true;
            }
        }
        System.assert(found, 'Search by last name should find the matching user');
    }

    @IsTest
    static void assignPermissionsCreatesNewPermissionSetAssignment() {
        PermissionSet permissionSet = createTestPermissionSet('New1');
        User user = createTestUser('New1');
        Date expiration = Date.today().addMonths(6);

        Test.startTest();
        List<InspectorNativePermissionAssignment.AssignmentResult> results = InspectorNativePermissionAssignment.assignPermissions(
            new List<String>{ permissionSet.Id },
            new List<String>(),
            new List<String>(),
            new List<String>{ user.Id },
            expiration
        );
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(true, results[0].success);
        System.assertEquals('Assigned', results[0].message);

        PermissionSetAssignment created = [
            SELECT ExpirationDate
            FROM PermissionSetAssignment
            WHERE AssigneeId = :user.Id AND PermissionSetId = :permissionSet.Id
        ];
        System.assertEquals(expiration, created.ExpirationDate);
    }

    @IsTest
    static void assignPermissionsCreatesNewPermissionSetGroupAssignment() {
        PermissionSetGroup permissionSetGroup = createTestPermissionSetGroup('New1');
        User user = createTestUser('New2');

        Test.startTest();
        List<InspectorNativePermissionAssignment.AssignmentResult> results = InspectorNativePermissionAssignment.assignPermissions(
            new List<String>(),
            new List<String>{ permissionSetGroup.Id },
            new List<String>(),
            new List<String>{ user.Id },
            null
        );
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(true, results[0].success);

        List<PermissionSetAssignment> created = [
            SELECT Id FROM PermissionSetAssignment WHERE AssigneeId = :user.Id AND PermissionSetGroupId = :permissionSetGroup.Id
        ];
        System.assertEquals(1, created.size());
    }

    @IsTest
    static void assignPermissionsUpdatesExpirationDateOnRerun() {
        PermissionSet permissionSet = createTestPermissionSet('Rerun1');
        User user = createTestUser('Rerun1');

        InspectorNativePermissionAssignment.assignPermissions(
            new List<String>{ permissionSet.Id },
            new List<String>(),
            new List<String>(),
            new List<String>{ user.Id },
            Date.today().addMonths(1)
        );

        Date newExpiration = Date.today().addMonths(3);
        Test.startTest();
        List<InspectorNativePermissionAssignment.AssignmentResult> results = InspectorNativePermissionAssignment.assignPermissions(
            new List<String>{ permissionSet.Id },
            new List<String>(),
            new List<String>(),
            new List<String>{ user.Id },
            newExpiration
        );
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals('Expiration date updated', results[0].message);

        List<PermissionSetAssignment> assignments = [
            SELECT ExpirationDate
            FROM PermissionSetAssignment
            WHERE AssigneeId = :user.Id AND PermissionSetId = :permissionSet.Id
        ];
        System.assertEquals(1, assignments.size(), 'Re-running should update the existing row, not create a second one');
        System.assertEquals(newExpiration, assignments[0].ExpirationDate);
    }

    @IsTest
    static void assignPermissionsReportsAlreadyAssignedWhenNothingChanged() {
        PermissionSet permissionSet = createTestPermissionSet('Unchanged1');
        User user = createTestUser('Unchanged1');

        InspectorNativePermissionAssignment.assignPermissions(
            new List<String>{ permissionSet.Id },
            new List<String>(),
            new List<String>(),
            new List<String>{ user.Id },
            null
        );

        Test.startTest();
        List<InspectorNativePermissionAssignment.AssignmentResult> results = InspectorNativePermissionAssignment.assignPermissions(
            new List<String>{ permissionSet.Id },
            new List<String>(),
            new List<String>(),
            new List<String>{ user.Id },
            null
        );
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(true, results[0].success);
        System.assertEquals('Already assigned', results[0].message);
    }

    @IsTest
    static void assignPermissionsCreatesNewPublicGroupMembership() {
        Group publicGroup = createTestPublicGroup('New1');
        User user = createTestUser('Group1');

        Test.startTest();
        List<InspectorNativePermissionAssignment.AssignmentResult> results = InspectorNativePermissionAssignment.assignPermissions(
            new List<String>(),
            new List<String>(),
            new List<String>{ publicGroup.Id },
            new List<String>{ user.Id },
            null
        );
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(true, results[0].success);
        System.assertEquals('Added to group', results[0].message);

        List<GroupMember> members = [SELECT Id FROM GroupMember WHERE GroupId = :publicGroup.Id AND UserOrGroupId = :user.Id];
        System.assertEquals(1, members.size());
    }

    @IsTest
    static void assignPermissionsSkipsDuplicatePublicGroupMembership() {
        Group publicGroup = createTestPublicGroup('Dup1');
        User user = createTestUser('Group2');

        InspectorNativePermissionAssignment.assignPermissions(
            new List<String>(), new List<String>(), new List<String>{ publicGroup.Id }, new List<String>{ user.Id }, null
        );

        Test.startTest();
        List<InspectorNativePermissionAssignment.AssignmentResult> results = InspectorNativePermissionAssignment.assignPermissions(
            new List<String>(), new List<String>(), new List<String>{ publicGroup.Id }, new List<String>{ user.Id }, null
        );
        Test.stopTest();

        System.assertEquals(1, results.size());
        System.assertEquals(true, results[0].success);
        System.assertEquals('Already a member', results[0].message);

        List<GroupMember> members = [SELECT Id FROM GroupMember WHERE GroupId = :publicGroup.Id AND UserOrGroupId = :user.Id];
        System.assertEquals(1, members.size(), 'Re-running should not create a duplicate membership row');
    }

    @IsTest
    static void assignPermissionsReturnsPerRowResultsWithoutThrowingOnPartialFailure() {
        PermissionSet goodPermissionSet = createTestPermissionSet('Good1');
        PermissionSet doomedPermissionSet = createTestPermissionSet('Doomed1');
        Id badPermissionSetId = doomedPermissionSet.Id;
        delete doomedPermissionSet;

        User user = createTestUser('Partial1');

        Test.startTest();
        List<InspectorNativePermissionAssignment.AssignmentResult> results = InspectorNativePermissionAssignment.assignPermissions(
            new List<String>{ goodPermissionSet.Id, String.valueOf(badPermissionSetId) },
            new List<String>(),
            new List<String>(),
            new List<String>{ user.Id },
            null
        );
        Test.stopTest();

        System.assertEquals(2, results.size(), 'Should get one result per row even though one target no longer exists');
        Integer successCount = 0;
        Integer failureCount = 0;
        for (InspectorNativePermissionAssignment.AssignmentResult result : results) {
            if (result.success) {
                successCount++;
            } else {
                failureCount++;
                System.assert(String.isNotBlank(result.message), 'Failed rows should carry an error message');
            }
        }
        System.assertEquals(1, successCount);
        System.assertEquals(1, failureCount);
    }
}
