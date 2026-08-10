/**
 * Lists assignable permission sets and grants field-level Read/Edit access on them, for the Field
 * Creator tab's Permissions modal. Unlike InspectorNativeFieldCreator (field creation, which needs
 * the Tooling API - see that class's doc comment for why), both operations here are plain,
 * standard Apex: PermissionSet is a normal queryable object, and FieldPermissions is a normal
 * queryable/DML-insertable object too - no callout needed for either.
 */
public with sharing class InspectorNativeFieldPermissions {
    public class PermissionSetOption {
        @AuraEnabled
        public String id;
        @AuraEnabled
        public String label;
    }

    // IsOwnedByProfile = false excludes the auto-generated permission sets Salesforce creates one
    // per Profile (not meaningful to offer those here - they're managed through the Profile itself).
    @AuraEnabled(cacheable=true)
    public static List<PermissionSetOption> getAssignablePermissionSets() {
        List<PermissionSetOption> options = new List<PermissionSetOption>();
        for (PermissionSet permissionSet : [SELECT Id, Label FROM PermissionSet WHERE IsOwnedByProfile = false ORDER BY Label]) {
            PermissionSetOption option = new PermissionSetOption();
            option.id = permissionSet.Id;
            option.label = permissionSet.Label;
            options.add(option);
        }
        return options;
    }

    public class FieldPermissionGrant {
        @AuraEnabled
        public String permissionSetId;
        @AuraEnabled
        public Boolean readAccess;
        @AuraEnabled
        public Boolean editAccess;
    }

    @AuraEnabled
    public static void grantFieldPermissions(String objectApiName, String fieldApiName, List<FieldPermissionGrant> grants) {
        String fullFieldName = objectApiName + '.' + fieldApiName;
        Set<Id> permissionSetIds = new Set<Id>();
        for (FieldPermissionGrant grant : grants) {
            if (String.isNotBlank(grant.permissionSetId)) {
                permissionSetIds.add(grant.permissionSetId);
            }
        }
        if (permissionSetIds.isEmpty()) {
            return;
        }

        Map<Id, FieldPermissions> existingByPermissionSetId = new Map<Id, FieldPermissions>();
        for (FieldPermissions existing : [
            SELECT Id, ParentId
            FROM FieldPermissions
            WHERE SobjectType = :objectApiName AND Field = :fullFieldName AND ParentId IN :permissionSetIds
        ]) {
            existingByPermissionSetId.put(existing.ParentId, existing);
        }

        List<FieldPermissions> toUpsert = new List<FieldPermissions>();
        for (FieldPermissionGrant grant : grants) {
            if (grant.readAccess != true && grant.editAccess != true) {
                continue; // nothing checked for this permission set - leave any existing grant alone
            }
            FieldPermissions fieldPermission = existingByPermissionSetId.get(grant.permissionSetId);
            if (fieldPermission == null) {
                fieldPermission = new FieldPermissions();
                fieldPermission.ParentId = grant.permissionSetId;
                fieldPermission.SobjectType = objectApiName;
                fieldPermission.Field = fullFieldName;
            }
            // Edit access requires read access - granting Edit always implies Read, matching how
            // the standard field-level security UI behaves.
            fieldPermission.PermissionsEdit = grant.editAccess == true;
            fieldPermission.PermissionsRead = grant.readAccess == true || fieldPermission.PermissionsEdit;
            toUpsert.add(fieldPermission);
        }
        if (!toUpsert.isEmpty()) {
            upsert toUpsert;
        }
    }
}
