@IsTest
private class InspectorNativeUserComparisonTest {
    private static PermissionSet createTestPermissionSet(String suffix) {
        PermissionSet permissionSet = new PermissionSet(Name = 'Test_User_Comp_' + suffix, Label = 'Test User Comp ' + suffix);
        insert permissionSet;
        return permissionSet;
    }

    private static PermissionSetGroup createTestPermissionSetGroup(String suffix) {
        PermissionSetGroup permissionSetGroup = new PermissionSetGroup(DeveloperName = 'Test_UC_PSG_' + suffix, MasterLabel = 'Test UC PSG ' + suffix);
        insert permissionSetGroup;
        return permissionSetGroup;
    }

    private static Group createTestPublicGroup(String suffix) {
        Group publicGroup = new Group(Name = 'Test UC Public Group ' + suffix, DeveloperName = 'Test_UC_Public_Group_' + suffix, Type = 'Regular');
        insert publicGroup;
        return publicGroup;
    }

    private static Group createTestQueue(String suffix) {
        Group queue = new Group(Name = 'Test UC Queue ' + suffix, DeveloperName = 'Test_UC_Queue_' + suffix, Type = 'Queue');
        insert queue;
        return queue;
    }

    private static User createTestUser(String suffix) {
        Profile standardProfile = [SELECT Id FROM Profile WHERE Name = 'Standard User' LIMIT 1];
        String uniqueSuffix = suffix + String.valueOf(System.currentTimeMillis());
        User user = new User(
            FirstName = 'Test',
            LastName = 'UserComp' + suffix,
            Email = 'test.usercomp.' + uniqueSuffix + '@example.com.invalid',
            Username = 'test.usercomp.' + uniqueSuffix + '@example.com.invalid',
            Alias = 'tuc' + suffix.left(3),
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
    static void getUserAssignmentsCategorizesDirectPermissionSetsSeparatelyFromGroups() {
        User user = createTestUser('Direct1');
        PermissionSet permissionSet = createTestPermissionSet('Direct1');
        PermissionSetGroup permissionSetGroup = createTestPermissionSetGroup('Direct1');
        insert new PermissionSetAssignment(AssigneeId = user.Id, PermissionSetId = permissionSet.Id);
        insert new PermissionSetAssignment(AssigneeId = user.Id, PermissionSetGroupId = permissionSetGroup.Id);

        Test.startTest();
        List<InspectorNativeUserComparison.UserAssignments> results = InspectorNativeUserComparison.getUserAssignments(user.Id, null);
        Test.stopTest();

        InspectorNativeUserComparison.UserAssignments userAssignments = results[0];
        System.assertEquals(1, userAssignments.permissionSetLabels.size());
        System.assertEquals('Test User Comp Direct1', userAssignments.permissionSetLabels[0]);
        System.assertEquals(1, userAssignments.permissionSetGroupLabels.size());
        System.assertEquals('Test UC PSG Direct1', userAssignments.permissionSetGroupLabels[0]);
    }

    @IsTest
    static void getUserAssignmentsReturnsPublicGroupMembershipScopedToRegularGroupsOnly() {
        User user = createTestUser('Group1');
        Group publicGroup = createTestPublicGroup('Group1');
        insert new GroupMember(GroupId = publicGroup.Id, UserOrGroupId = user.Id);

        Test.startTest();
        List<InspectorNativeUserComparison.UserAssignments> results = InspectorNativeUserComparison.getUserAssignments(user.Id, null);
        Test.stopTest();

        System.assertEquals(1, results[0].publicGroupNames.size());
        System.assertEquals('Test UC Public Group Group1', results[0].publicGroupNames[0]);
    }

    @IsTest
    static void getUserAssignmentsCategorizesQueueMembershipSeparatelyFromPublicGroups() {
        User user = createTestUser('Queue1');
        Group publicGroup = createTestPublicGroup('Queue1');
        Group queue = createTestQueue('Queue1');
        insert new GroupMember(GroupId = publicGroup.Id, UserOrGroupId = user.Id);
        insert new GroupMember(GroupId = queue.Id, UserOrGroupId = user.Id);

        Test.startTest();
        List<InspectorNativeUserComparison.UserAssignments> results = InspectorNativeUserComparison.getUserAssignments(user.Id, null);
        Test.stopTest();

        InspectorNativeUserComparison.UserAssignments userAssignments = results[0];
        System.assertEquals(1, userAssignments.queueNames.size());
        System.assertEquals('Test UC Queue Queue1', userAssignments.queueNames[0]);
        System.assertEquals(1, userAssignments.publicGroupNames.size());
        System.assertEquals('Test UC Public Group Queue1', userAssignments.publicGroupNames[0]);
    }

    @IsTest
    static void getUserAssignmentsReturnsResultsInFirstThenSecondUserOrder() {
        User firstUser = createTestUser('Order1');
        User secondUser = createTestUser('Order2');
        PermissionSet firstOnlySet = createTestPermissionSet('Order1');
        insert new PermissionSetAssignment(AssigneeId = firstUser.Id, PermissionSetId = firstOnlySet.Id);

        Test.startTest();
        List<InspectorNativeUserComparison.UserAssignments> results = InspectorNativeUserComparison.getUserAssignments(secondUser.Id, firstUser.Id);
        Test.stopTest();

        System.assertEquals(2, results.size());
        System.assertEquals(secondUser.Id, results[0].userId, 'The first result should correspond to firstUserId, not User.Id order');
        System.assertEquals(0, results[0].permissionSetLabels.size());
        System.assertEquals(firstUser.Id, results[1].userId);
        System.assertEquals(1, results[1].permissionSetLabels.size());
    }

    @IsTest
    static void getUserAssignmentsReturnsEmptyListsForAUserWithNoAssignmentsAtAll() {
        User user = createTestUser('Empty1');

        Test.startTest();
        List<InspectorNativeUserComparison.UserAssignments> results = InspectorNativeUserComparison.getUserAssignments(user.Id, null);
        Test.stopTest();

        System.assertEquals(0, results[0].permissionSetLabels.size());
        System.assertEquals(0, results[0].permissionSetGroupLabels.size());
        System.assertEquals(0, results[0].publicGroupNames.size());
        System.assertEquals(0, results[0].queueNames.size());
        // The second slot corresponds to a blank secondUserId - still a well-formed, empty result,
        // never null, so the client never has to null-check before reading its list fields.
        System.assertEquals(0, results[1].permissionSetLabels.size());
    }

    @IsTest
    static void getUserAssignmentsHandlesBothUserIdsBlank() {
        Test.startTest();
        List<InspectorNativeUserComparison.UserAssignments> results = InspectorNativeUserComparison.getUserAssignments(null, null);
        Test.stopTest();

        System.assertEquals(2, results.size());
        System.assertEquals(0, results[0].permissionSetLabels.size());
        System.assertEquals(0, results[1].permissionSetLabels.size());
    }
}
