/**
 * Lists assignable permission sets and grants field-level Read/Edit access on them, for the Field
 * Creator tab's Permissions modal. Unlike InspectorNativeFieldCreator (field creation, which needs
 * the Tooling API - see that class's doc comment for why), both operations here are plain,
 * standard Apex: PermissionSet is a normal queryable object, and FieldPermissions is a normal
 * queryable/DML-insertable object too - no callout needed for either.
 *
 * The grant type (InspectorNativeFieldPermissionGrant) is its own top-level class, not nested in
 * here - see that class's doc comment for why (Apex inner classes aren't reliable as List<T>
 * parameter types for LWC-invoked methods).
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
    //
    // Type = 'Regular' excludes every other PermissionSet Type (e.g. 'Standard', the type Salesforce
    // uses for the permission sets it auto-provisions alongside a Permission Set License, typically
    // from an installed package or platform feature) - confirmed live, the hard way, across several
    // rounds of a field-level-security save failing with an opaque INVALID_CROSS_REFERENCE_KEY error
    // no matter what this app tried on its own end, that Salesforce simply does not allow direct
    // FieldPermissions/ObjectPermissions DML against a non-Regular PermissionSet at all - it's not a
    // dependency this app can satisfy or work around, the platform predefines and locks those
    // permission sets down entirely. Only Regular (user-created, fully org-controlled) permission
    // sets are ever genuinely editable here, so those are the only ones worth offering.
    @AuraEnabled(cacheable=true)
    public static List<PermissionSetOption> getAssignablePermissionSets() {
        List<PermissionSetOption> options = new List<PermissionSetOption>();
        for (PermissionSet permissionSet : [SELECT Id, Label FROM PermissionSet WHERE IsOwnedByProfile = false AND Type = 'Regular' ORDER BY Label]) {
            PermissionSetOption option = new PermissionSetOption();
            option.id = permissionSet.Id;
            option.label = permissionSet.Label;
            options.add(option);
        }
        return options;
    }

    @AuraEnabled
    public static void grantFieldPermissions(String objectApiName, String fieldApiName, List<InspectorNativeFieldPermissionGrant> grants) {
        String fullFieldName = objectApiName + '.' + fieldApiName;
        Set<Id> permissionSetIds = new Set<Id>();
        for (InspectorNativeFieldPermissionGrant grant : grants) {
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
        for (InspectorNativeFieldPermissionGrant grant : grants) {
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
