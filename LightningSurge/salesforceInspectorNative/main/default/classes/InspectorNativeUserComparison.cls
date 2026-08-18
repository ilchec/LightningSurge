/**
 * Reads what two Users are each currently assigned - Permission Sets, Permission Set Groups, Public
 * Group membership, and Queue membership - for the User Comparison tab. Read-only, `with sharing`,
 * no DML anywhere in this class - same low-risk tier as InspectorNativeOrgInfo/
 * InspectorNativeRecordAccess, no extra system permission needed beyond the app's own base
 * permission set.
 *
 * This repo has never queried PermissionSetAssignment or GroupMember via the UI API GraphQL wire
 * anywhere - only ever via plain Apex SOQL, in InspectorNativePermissionAssignment.cls (the tab this
 * one's search box borrows from). Rather than gamble on unverified GraphQL exposure for these two
 * setup/junction objects, this follows that same proven, already-working Apex/SOQL path. Basic User
 * fields (Username, Email, Profile, Role, Manager, ...) are NOT read here - those are already
 * reliably reachable via plain GraphQL (User is core UI API territory), so the LWC reads them
 * directly rather than duplicating that through Apex.
 *
 * A PermissionSetAssignment row for a Permission Set *Group* may also carry a PermissionSetId -
 * confirmed in this app's own InspectorNativePermissionAssignment.assignPermissionSetsAndGroups,
 * inserting one only ever sets PermissionSetGroupId explicitly, but the platform is known to
 * backfill PermissionSetId afterward, pointing at the group's own internal aggregate PermissionSet
 * rather than a real, independently assignable one. Checking PermissionSetGroupId first (before
 * ever looking at PermissionSet.Label) means that distinction doesn't matter either way - such a
 * row is always categorized as a group, never miscounted as a plain permission set the user
 * separately has.
 *
 * Unlike Picklist Manager/FLS Matrix (editors, which only ever offer Type = 'Regular' permission
 * sets - the only ones actually editable), this is a read-only reporting tool: every directly-
 * assigned permission set is included regardless of Type, Standard (package-provided) ones
 * included, since the point here is visibility into everything a user actually has, not what's
 * safe to edit.
 */
public with sharing class InspectorNativeUserComparison {
    public class UserAssignments {
        @AuraEnabled
        public String userId;
        @AuraEnabled
        public List<String> permissionSetLabels;
        @AuraEnabled
        public List<String> permissionSetGroupLabels;
        @AuraEnabled
        public List<String> publicGroupNames;
        @AuraEnabled
        public List<String> queueNames;
    }

    // Returned in (firstUserId, secondUserId) order - the same order the caller passed in - so the
    // client never has to re-match results back to a user by Id.
    @AuraEnabled(cacheable=true)
    public static List<UserAssignments> getUserAssignments(String firstUserId, String secondUserId) {
        Set<Id> userIds = new Set<Id>();
        if (String.isNotBlank(firstUserId)) {
            userIds.add(firstUserId);
        }
        if (String.isNotBlank(secondUserId)) {
            userIds.add(secondUserId);
        }

        Map<Id, UserAssignments> assignmentsByUserId = new Map<Id, UserAssignments>();
        for (Id userId : userIds) {
            UserAssignments assignments = new UserAssignments();
            assignments.userId = userId;
            assignments.permissionSetLabels = new List<String>();
            assignments.permissionSetGroupLabels = new List<String>();
            assignments.publicGroupNames = new List<String>();
            assignments.queueNames = new List<String>();
            assignmentsByUserId.put(userId, assignments);
        }

        if (!userIds.isEmpty()) {
            for (PermissionSetAssignment assignment : [
                SELECT AssigneeId, PermissionSetGroupId, PermissionSetGroup.MasterLabel, PermissionSet.Label
                FROM PermissionSetAssignment
                WHERE AssigneeId IN :userIds
            ]) {
                UserAssignments assignments = assignmentsByUserId.get(assignment.AssigneeId);
                if (assignment.PermissionSetGroupId != null) {
                    assignments.permissionSetGroupLabels.add(assignment.PermissionSetGroup.MasterLabel);
                } else {
                    assignments.permissionSetLabels.add(assignment.PermissionSet.Label);
                }
            }

            for (GroupMember member : [
                SELECT UserOrGroupId, Group.Name, Group.Type
                FROM GroupMember
                WHERE UserOrGroupId IN :userIds AND Group.Type IN ('Regular', 'Queue')
            ]) {
                UserAssignments assignments = assignmentsByUserId.get(member.UserOrGroupId);
                if (member.Group.Type == 'Queue') {
                    assignments.queueNames.add(member.Group.Name);
                } else {
                    assignments.publicGroupNames.add(member.Group.Name);
                }
            }
        }

        List<UserAssignments> results = new List<UserAssignments>();
        for (String userId : new List<String>{ firstUserId, secondUserId }) {
            UserAssignments assignments = String.isNotBlank(userId) ? assignmentsByUserId.get(userId) : null;
            results.add(assignments != null ? assignments : buildEmptyAssignments());
        }
        return results;
    }

    private static UserAssignments buildEmptyAssignments() {
        UserAssignments assignments = new UserAssignments();
        assignments.permissionSetLabels = new List<String>();
        assignments.permissionSetGroupLabels = new List<String>();
        assignments.publicGroupNames = new List<String>();
        assignments.queueNames = new List<String>();
        return assignments;
    }
}
