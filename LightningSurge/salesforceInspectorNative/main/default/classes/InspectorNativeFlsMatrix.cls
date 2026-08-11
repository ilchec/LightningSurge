/**
 * Bulk field-level-security matrix for the FLS Matrix tab: every FLS-eligible field on an object
 * crossed with every assignable permission set, current Read/Edit state pre-loaded, bulk-saveable
 * in one call. Same low-risk shape as InspectorNativeFieldPermissions - plain, standard SOQL/DML,
 * no callout - this is that same idea scaled from "one field's grants" up to "every field's grants
 * on this object at once".
 *
 * Unlike InspectorNativeFieldPermissions.grantFieldPermissions (additive-only: it only ever grants
 * a newly-created field's permissions, never revokes anything), this tool IS the editor of record
 * for a permission set's field access on this object - an explicit uncheck must actually remove
 * access, not be silently ignored the way it is there. saveFieldPermissions deletes the
 * FieldPermissions row entirely when both Read and Edit end up unchecked, rather than leaving a
 * zero-access row behind.
 */
public with sharing class InspectorNativeFlsMatrix {
    public class FieldOption {
        @AuraEnabled
        public String apiName;
        @AuraEnabled
        public String label;
    }

    public class FlsGrantState {
        @AuraEnabled
        public String fieldApiName;
        @AuraEnabled
        public String permissionSetId;
        @AuraEnabled
        public Boolean readAccess;
        @AuraEnabled
        public Boolean editAccess;
    }

    public class FlsMatrixResult {
        @AuraEnabled
        public List<FieldOption> fields;
        @AuraEnabled
        public List<InspectorNativeFieldPermissions.PermissionSetOption> permissionSets;
        @AuraEnabled
        public List<FlsGrantState> existingGrants;
    }

    // isPermissionable() is the platform's own authority on whether a field supports field-level
    // security at all - some fields (Id, and a handful of others core to every object) can never be
    // restricted regardless of which API attempts it, and upserting a FieldPermissions row for one
    // would fail. Filtering on this up front means every field this tool ever offers is genuinely
    // save-able - no dead-end selections.
    @AuraEnabled(cacheable=true)
    public static FlsMatrixResult getFieldPermissionMatrix(String objectApiName) {
        Schema.SObjectType sObjType = Schema.getGlobalDescribe().get(objectApiName);
        if (sObjType == null) {
            throw new AuraHandledException('Unknown object: ' + objectApiName);
        }

        FlsMatrixResult result = new FlsMatrixResult();
        result.permissionSets = InspectorNativeFieldPermissions.getAssignablePermissionSets();

        result.fields = new List<FieldOption>();
        for (Schema.SObjectField sObjField : sObjType.getDescribe().fields.getMap().values()) {
            Schema.DescribeFieldResult fieldDescribe = sObjField.getDescribe();
            if (fieldDescribe.isPermissionable()) {
                FieldOption option = new FieldOption();
                option.apiName = fieldDescribe.getName();
                option.label = fieldDescribe.getLabel();
                result.fields.add(option);
            }
        }
        result.fields.sort(new FieldOptionByLabel());

        Set<Id> permissionSetIds = new Set<Id>();
        for (InspectorNativeFieldPermissions.PermissionSetOption option : result.permissionSets) {
            permissionSetIds.add(option.id);
        }
        result.existingGrants = new List<FlsGrantState>();
        if (!permissionSetIds.isEmpty()) {
            for (FieldPermissions existing : [
                SELECT Field, ParentId, PermissionsRead, PermissionsEdit
                FROM FieldPermissions
                WHERE SobjectType = :objectApiName AND ParentId IN :permissionSetIds
            ]) {
                FlsGrantState state = new FlsGrantState();
                // Field is stored as "Object.Field" - strip the object prefix so the client can key
                // by plain field apiName, matching what `fields` above already lists.
                List<String> parts = existing.Field.split('\\.');
                state.fieldApiName = parts.size() > 1 ? parts[1] : existing.Field;
                state.permissionSetId = existing.ParentId;
                state.readAccess = existing.PermissionsRead;
                state.editAccess = existing.PermissionsEdit;
                result.existingGrants.add(state);
            }
        }
        return result;
    }

    @AuraEnabled
    public static void saveFieldPermissions(String objectApiName, List<InspectorNativeFlsGrant> grants) {
        Set<Id> permissionSetIds = new Set<Id>();
        for (InspectorNativeFlsGrant grant : grants) {
            if (String.isNotBlank(grant.permissionSetId)) {
                permissionSetIds.add(grant.permissionSetId);
            }
        }
        if (permissionSetIds.isEmpty()) {
            return;
        }

        Map<String, FieldPermissions> existingByKey = new Map<String, FieldPermissions>();
        for (FieldPermissions existing : [
            SELECT Id, ParentId, Field
            FROM FieldPermissions
            WHERE SobjectType = :objectApiName AND ParentId IN :permissionSetIds
        ]) {
            existingByKey.put(existing.ParentId + '.' + existing.Field, existing);
        }

        List<FieldPermissions> toUpsert = new List<FieldPermissions>();
        List<FieldPermissions> toDelete = new List<FieldPermissions>();
        for (InspectorNativeFlsGrant grant : grants) {
            if (String.isBlank(grant.fieldApiName) || String.isBlank(grant.permissionSetId)) {
                continue;
            }
            String fullFieldName = objectApiName + '.' + grant.fieldApiName;
            String key = grant.permissionSetId + '.' + fullFieldName;
            FieldPermissions existing = existingByKey.get(key);
            Boolean wantsAnyAccess = grant.readAccess == true || grant.editAccess == true;

            if (!wantsAnyAccess) {
                if (existing != null) {
                    toDelete.add(existing);
                }
                continue;
            }

            FieldPermissions fieldPermission = existing != null ? existing : new FieldPermissions();
            if (existing == null) {
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
        if (!toDelete.isEmpty()) {
            delete toDelete;
        }
    }

    private class FieldOptionByLabel implements Comparator<FieldOption> {
        public Integer compare(FieldOption a, FieldOption b) {
            return a.label.compareTo(b.label);
        }
    }
}
