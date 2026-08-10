/**
 * Bulk-assigns Permission Sets, Permission Set Groups, and Public Groups to a set of users, for the
 * Permissions and Groups tab. All three targets are plain, standard Apex - PermissionSetAssignment
 * (which takes either PermissionSetId or PermissionSetGroupId, GA since Spring '20) and GroupMember
 * are both normal queryable/DML-insertable objects, no callout needed - unlike InspectorNativeFieldCreator's
 * field creation, which has to go through the Tooling API.
 *
 * GroupMember has no expiration field at all, so Public Group membership is permanent by platform
 * design - only Permission Set / Permission Set Group assignments (via PermissionSetAssignment)
 * support an expiration date.
 *
 * Re-running an assignment for a user who already has a given Permission Set/Group updates that
 * existing assignment's ExpirationDate rather than erroring or being silently skipped - this makes
 * the tab useful for bulk-extending/changing expirations later, not just first-time grants. Public
 * Group membership has no such update path (nothing to update) - an existing membership is just
 * reported back as already in place.
 */
public with sharing class InspectorNativePermissionAssignment {
    public class AssignableItem {
        @AuraEnabled
        public String id;
        @AuraEnabled
        public String label;
        @AuraEnabled
        public String type; // 'PermissionSet' | 'PermissionSetGroup' | 'PublicGroup'
    }

    // IsOwnedByProfile = false excludes the auto-generated permission sets Salesforce creates one
    // per Profile - not meaningful to assign directly, same exclusion InspectorNativeFieldPermissions
    // already uses. Type = 'Regular' on Group scopes results to actual Public Groups, excluding
    // Queues/Roles/RoleAndSubordinates and other internal Group types that share the same object.
    @AuraEnabled(cacheable=true)
    public static List<AssignableItem> getAssignableItems() {
        List<AssignableItem> items = new List<AssignableItem>();
        for (PermissionSet permissionSet : [SELECT Id, Label FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label]) {
            items.add(buildAssignableItem(permissionSet.Id, permissionSet.Label, 'PermissionSet'));
        }
        for (PermissionSetGroup permissionSetGroup : [SELECT Id, MasterLabel FROM PermissionSetGroup ORDER BY MasterLabel]) {
            items.add(buildAssignableItem(permissionSetGroup.Id, permissionSetGroup.MasterLabel, 'PermissionSetGroup'));
        }
        for (Group publicGroup : [SELECT Id, Name FROM Group WHERE Type = 'Regular' ORDER BY Name]) {
            items.add(buildAssignableItem(publicGroup.Id, publicGroup.Name, 'PublicGroup'));
        }
        return items;
    }

    private static AssignableItem buildAssignableItem(Id id, String label, String type) {
        AssignableItem item = new AssignableItem();
        item.id = id;
        item.label = label;
        item.type = type;
        return item;
    }

    public class UserOption {
        @AuraEnabled
        public String id;
        @AuraEnabled
        public String name;
        @AuraEnabled
        public String username;
        @AuraEnabled
        public String email;
    }

    // Not cacheable - the search term varies per call. Requires 2+ characters so a blank/near-blank
    // search box doesn't trigger a scan across every active user in the org.
    @AuraEnabled
    public static List<UserOption> searchUsers(String searchTerm) {
        List<UserOption> options = new List<UserOption>();
        if (String.isBlank(searchTerm) || searchTerm.trim().length() < 2) {
            return options;
        }
        String likeTerm = '%' + searchTerm.trim() + '%';
        for (User user : [
            SELECT Id, Name, Username, Email
            FROM User
            WHERE IsActive = true AND (Name LIKE :likeTerm OR Username LIKE :likeTerm OR Email LIKE :likeTerm)
            ORDER BY Name
            LIMIT 50
        ]) {
            UserOption option = new UserOption();
            option.id = user.Id;
            option.name = user.Name;
            option.username = user.Username;
            option.email = user.Email;
            options.add(option);
        }
        return options;
    }

    public class AssignmentResult {
        @AuraEnabled
        public String userLabel;
        @AuraEnabled
        public String targetLabel;
        @AuraEnabled
        public String targetType;
        @AuraEnabled
        public Boolean success;
        @AuraEnabled
        public String message;
    }

    // A user/target pair not yet turned into an AssignmentResult - carries the built SObject (for
    // pairs that need an insert/update) through to the DML call, so Database.SaveResult rows (which
    // come back positionally) can be matched back to the right user/target labels afterward.
    private class PendingAssignment {
        Id userId;
        Id targetId;
        String targetType;
        SObject record;
    }

    @AuraEnabled
    public static List<AssignmentResult> assignPermissions(
        List<String> permissionSetIds,
        List<String> permissionSetGroupIds,
        List<String> publicGroupIds,
        List<String> userIds,
        Date expirationDate
    ) {
        List<AssignmentResult> results = new List<AssignmentResult>();
        if (userIds == null || userIds.isEmpty()) {
            return results;
        }

        Set<Id> permissionSetIdSet = toIdSet(permissionSetIds);
        Set<Id> permissionSetGroupIdSet = toIdSet(permissionSetGroupIds);
        Set<Id> publicGroupIdSet = toIdSet(publicGroupIds);

        Map<Id, String> labelByTargetId = new Map<Id, String>();
        if (!permissionSetIdSet.isEmpty()) {
            for (PermissionSet permissionSet : [SELECT Id, Label FROM PermissionSet WHERE Id IN :permissionSetIdSet]) {
                labelByTargetId.put(permissionSet.Id, permissionSet.Label);
            }
        }
        if (!permissionSetGroupIdSet.isEmpty()) {
            for (PermissionSetGroup permissionSetGroup : [SELECT Id, MasterLabel FROM PermissionSetGroup WHERE Id IN :permissionSetGroupIdSet]) {
                labelByTargetId.put(permissionSetGroup.Id, permissionSetGroup.MasterLabel);
            }
        }
        if (!publicGroupIdSet.isEmpty()) {
            for (Group publicGroup : [SELECT Id, Name FROM Group WHERE Id IN :publicGroupIdSet]) {
                labelByTargetId.put(publicGroup.Id, publicGroup.Name);
            }
        }
        Map<Id, String> labelByUserId = new Map<Id, String>();
        for (User user : [SELECT Id, Name FROM User WHERE Id IN :userIds]) {
            labelByUserId.put(user.Id, user.Name);
        }

        results.addAll(
            assignPermissionSetsAndGroups(permissionSetIdSet, permissionSetGroupIdSet, userIds, expirationDate, labelByTargetId, labelByUserId)
        );
        results.addAll(assignPublicGroups(publicGroupIdSet, userIds, labelByTargetId, labelByUserId));
        return results;
    }

    private static List<AssignmentResult> assignPermissionSetsAndGroups(
        Set<Id> permissionSetIds,
        Set<Id> permissionSetGroupIds,
        List<String> userIds,
        Date expirationDate,
        Map<Id, String> labelByTargetId,
        Map<Id, String> labelByUserId
    ) {
        List<AssignmentResult> results = new List<AssignmentResult>();
        if (permissionSetIds.isEmpty() && permissionSetGroupIds.isEmpty()) {
            return results;
        }

        Map<String, PermissionSetAssignment> existingByKey = new Map<String, PermissionSetAssignment>();
        for (PermissionSetAssignment assignment : [
            SELECT Id, AssigneeId, PermissionSetId, PermissionSetGroupId, ExpirationDate
            FROM PermissionSetAssignment
            WHERE AssigneeId IN :userIds AND (PermissionSetId IN :permissionSetIds OR PermissionSetGroupId IN :permissionSetGroupIds)
        ]) {
            Id targetId = assignment.PermissionSetGroupId != null ? assignment.PermissionSetGroupId : assignment.PermissionSetId;
            existingByKey.put(assignmentKey(assignment.AssigneeId, targetId), assignment);
        }

        List<PendingAssignment> toInsert = new List<PendingAssignment>();
        List<PendingAssignment> toUpdate = new List<PendingAssignment>();
        for (String userIdStr : userIds) {
            Id userId = Id.valueOf(userIdStr);
            for (Id targetId : permissionSetIds) {
                bucketPermissionAssignment(
                    userId,
                    targetId,
                    'PermissionSet',
                    expirationDate,
                    existingByKey,
                    toInsert,
                    toUpdate,
                    results,
                    labelByTargetId,
                    labelByUserId
                );
            }
            for (Id targetId : permissionSetGroupIds) {
                bucketPermissionAssignment(
                    userId,
                    targetId,
                    'PermissionSetGroup',
                    expirationDate,
                    existingByKey,
                    toInsert,
                    toUpdate,
                    results,
                    labelByTargetId,
                    labelByUserId
                );
            }
        }

        if (!toInsert.isEmpty()) {
            List<Database.SaveResult> saveResults = Database.insert(recordsOf(toInsert), false);
            for (Integer i = 0; i < toInsert.size(); i++) {
                results.add(buildResult(toInsert[i], 'Assigned', saveResults[i], labelByTargetId, labelByUserId));
            }
        }
        if (!toUpdate.isEmpty()) {
            List<Database.SaveResult> saveResults = Database.update(recordsOf(toUpdate), false);
            for (Integer i = 0; i < toUpdate.size(); i++) {
                results.add(buildResult(toUpdate[i], 'Expiration date updated', saveResults[i], labelByTargetId, labelByUserId));
            }
        }
        return results;
    }

    private static void bucketPermissionAssignment(
        Id userId,
        Id targetId,
        String targetType,
        Date expirationDate,
        Map<String, PermissionSetAssignment> existingByKey,
        List<PendingAssignment> toInsert,
        List<PendingAssignment> toUpdate,
        List<AssignmentResult> unchangedResults,
        Map<Id, String> labelByTargetId,
        Map<Id, String> labelByUserId
    ) {
        PermissionSetAssignment existing = existingByKey.get(assignmentKey(userId, targetId));
        if (existing == null) {
            PermissionSetAssignment record = targetType == 'PermissionSet'
                ? new PermissionSetAssignment(AssigneeId = userId, PermissionSetId = targetId, ExpirationDate = expirationDate)
                : new PermissionSetAssignment(AssigneeId = userId, PermissionSetGroupId = targetId, ExpirationDate = expirationDate);
            toInsert.add(pendingAssignment(userId, targetId, targetType, record));
        } else if (existing.ExpirationDate != expirationDate) {
            toUpdate.add(pendingAssignment(userId, targetId, targetType, new PermissionSetAssignment(Id = existing.Id, ExpirationDate = expirationDate)));
        } else {
            unchangedResults.add(buildStaticResult(userId, targetId, targetType, true, 'Already assigned', labelByTargetId, labelByUserId));
        }
    }

    private static List<AssignmentResult> assignPublicGroups(
        Set<Id> publicGroupIds, List<String> userIds, Map<Id, String> labelByTargetId, Map<Id, String> labelByUserId
    ) {
        List<AssignmentResult> results = new List<AssignmentResult>();
        if (publicGroupIds.isEmpty()) {
            return results;
        }

        Set<String> existingKeys = new Set<String>();
        for (GroupMember member : [SELECT GroupId, UserOrGroupId FROM GroupMember WHERE GroupId IN :publicGroupIds AND UserOrGroupId IN :userIds]) {
            existingKeys.add(assignmentKey(member.UserOrGroupId, member.GroupId));
        }

        List<PendingAssignment> toInsert = new List<PendingAssignment>();
        for (String userIdStr : userIds) {
            Id userId = Id.valueOf(userIdStr);
            for (Id groupId : publicGroupIds) {
                if (existingKeys.contains(assignmentKey(userId, groupId))) {
                    results.add(buildStaticResult(userId, groupId, 'PublicGroup', true, 'Already a member', labelByTargetId, labelByUserId));
                    continue;
                }
                toInsert.add(pendingAssignment(userId, groupId, 'PublicGroup', new GroupMember(GroupId = groupId, UserOrGroupId = userId)));
            }
        }

        if (!toInsert.isEmpty()) {
            List<Database.SaveResult> saveResults = Database.insert(recordsOf(toInsert), false);
            for (Integer i = 0; i < toInsert.size(); i++) {
                results.add(buildResult(toInsert[i], 'Added to group', saveResults[i], labelByTargetId, labelByUserId));
            }
        }
        return results;
    }

    private static PendingAssignment pendingAssignment(Id userId, Id targetId, String targetType, SObject record) {
        PendingAssignment pending = new PendingAssignment();
        pending.userId = userId;
        pending.targetId = targetId;
        pending.targetType = targetType;
        pending.record = record;
        return pending;
    }

    private static List<SObject> recordsOf(List<PendingAssignment> pendingAssignments) {
        List<SObject> records = new List<SObject>();
        for (PendingAssignment pending : pendingAssignments) {
            records.add(pending.record);
        }
        return records;
    }

    private static AssignmentResult buildResult(
        PendingAssignment pending, String successMessage, Database.SaveResult saveResult, Map<Id, String> labelByTargetId, Map<Id, String> labelByUserId
    ) {
        String message = saveResult.isSuccess()
            ? successMessage
            : (saveResult.getErrors().isEmpty() ? 'Unknown error' : saveResult.getErrors()[0].getMessage());
        return buildStaticResult(pending.userId, pending.targetId, pending.targetType, saveResult.isSuccess(), message, labelByTargetId, labelByUserId);
    }

    private static AssignmentResult buildStaticResult(
        Id userId, Id targetId, String targetType, Boolean success, String message, Map<Id, String> labelByTargetId, Map<Id, String> labelByUserId
    ) {
        AssignmentResult result = new AssignmentResult();
        result.userLabel = labelByUserId.get(userId);
        result.targetLabel = labelByTargetId.get(targetId);
        result.targetType = targetType;
        result.success = success;
        result.message = message;
        return result;
    }

    private static String assignmentKey(Id userId, Id targetId) {
        return String.valueOf(userId) + '|' + String.valueOf(targetId);
    }

    // The loop variable here deliberately isn't named "id" - Apex identifiers are case-insensitive,
    // so a local "id" shadows the "Id" type within this scope and breaks the Id.valueOf(...) call
    // below (resolves as a static-from-instance-context error instead).
    private static Set<Id> toIdSet(List<String> ids) {
        Set<Id> idSet = new Set<Id>();
        if (ids != null) {
            for (String rawId : ids) {
                if (String.isNotBlank(rawId)) {
                    idSet.add(Id.valueOf(rawId));
                }
            }
        }
        return idSet;
    }
}
