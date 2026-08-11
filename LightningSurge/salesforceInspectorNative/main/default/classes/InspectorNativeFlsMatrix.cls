/**
 * Bulk field-level-security matrix for the FLS Matrix tab: every FLS-eligible field on an object
 * crossed with every assignable permission set, current Read/Edit state pre-loaded, bulk-saveable
 * in one call. Same low-risk shape as InspectorNativeFieldPermissions - plain, standard SOQL/DML,
 * no callout - this is that same idea scaled from "one field's grants" up to "every field's grants
 * on this object at once". Also covers object-level access (ObjectPermissions) on the same object,
 * one row of checkboxes per permission set rendered as a second header row above the field matrix -
 * field-level security on the platform is only meaningful alongside at least Read at the object
 * level, so a tool for editing one without the other is only half the picture.
 *
 * Unlike InspectorNativeFieldPermissions.grantFieldPermissions (additive-only: it only ever grants
 * a newly-created field's permissions, never revokes anything), this tool IS the editor of record
 * for a permission set's field access on this object - an explicit uncheck must actually remove
 * access, not be silently ignored the way it is there. saveFieldPermissions deletes the
 * FieldPermissions row entirely when both Read and Edit end up unchecked, rather than leaving a
 * zero-access row behind. ObjectPermissions rows are only ever upserted, never deleted, even when
 * every box is unchecked - unlike FieldPermissions, whether an ObjectPermissions row can be deleted
 * via DML at all wasn't confirmed, so this only ever zeroes out its access flags, the same end
 * state Setup's own "Object Settings" page leaves an object's permissions in when nothing is
 * granted - never an attempted delete that might fail for a reason unrelated to what the user
 * actually asked to do.
 *
 * ensureObjectReadForFieldGrants auto-grants object-level Read whenever a field-level grant needs it
 * and the target permission set doesn't already have it on this object - confirmed live that the
 * platform enforces this dependency itself (an upsert of a FieldPermissions row for a permission set
 * with no object-level Read on the same object fails outright with a fairly opaque
 * INVALID_CROSS_REFERENCE_KEY error), the same dependency Setup's own Field-Level Security page
 * enforces by not even letting you reach a field's security settings for an object the permission
 * set has no access to yet.
 *
 * It's a separate @AuraEnabled method, called and awaited by the client BEFORE saveFieldPermissions,
 * rather than folded into saveFieldPermissions's own transaction - confirmed live (the hard way, by
 * splitting one shared try/catch into two and reading which one actually threw) that upserting the
 * object-level Read grant and then immediately upserting the dependent field-level grant in the very
 * same Apex transaction still fails with the identical INVALID_CROSS_REFERENCE_KEY error, every time,
 * even though the object-level upsert itself reports success. Whatever check the platform runs to
 * enforce this dependency during a FieldPermissions upsert appears to look at already-committed
 * state, not an earlier DML statement's uncommitted effect within the same transaction - so the two
 * grants have to land in genuinely separate, sequential Apex transactions (two separate @AuraEnabled
 * calls, not two DML statements in one call) for the dependency to actually be satisfied by the time
 * the field-level grant is attempted.
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

    public class ObjectPermissionState {
        @AuraEnabled
        public String permissionSetId;
        @AuraEnabled
        public Boolean readAccess;
        @AuraEnabled
        public Boolean createAccess;
        @AuraEnabled
        public Boolean editAccess;
        @AuraEnabled
        public Boolean deleteAccess;
        @AuraEnabled
        public Boolean viewAllAccess;
        @AuraEnabled
        public Boolean modifyAllAccess;
    }

    public class FlsMatrixResult {
        @AuraEnabled
        public List<FieldOption> fields;
        @AuraEnabled
        public List<InspectorNativeFieldPermissions.PermissionSetOption> permissionSets;
        @AuraEnabled
        public List<FlsGrantState> existingGrants;
        @AuraEnabled
        public List<ObjectPermissionState> existingObjectPermissions;
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
        result.existingObjectPermissions = new List<ObjectPermissionState>();
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

            for (ObjectPermissions existing : [
                SELECT ParentId, PermissionsRead, PermissionsCreate, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords
                FROM ObjectPermissions
                WHERE SobjectType = :objectApiName AND ParentId IN :permissionSetIds
            ]) {
                ObjectPermissionState state = new ObjectPermissionState();
                state.permissionSetId = existing.ParentId;
                state.readAccess = existing.PermissionsRead;
                state.createAccess = existing.PermissionsCreate;
                state.editAccess = existing.PermissionsEdit;
                state.deleteAccess = existing.PermissionsDelete;
                state.viewAllAccess = existing.PermissionsViewAllRecords;
                state.modifyAllAccess = existing.PermissionsModifyAllRecords;
                result.existingObjectPermissions.add(state);
            }
        }
        return result;
    }

    // Its own @AuraEnabled entry point (its own Apex transaction) specifically so its DML commits
    // before the client's follow-up saveFieldPermissions call runs - see the class doc comment for
    // why that separation is required, confirmed live. Takes the same grantsJson shape
    // saveFieldPermissions does (JSON-string parameter, not a typed List<T> - see that method's own
    // comment for why) so the client can pass through the exact same payload it's about to save.
    @AuraEnabled
    public static void ensureObjectReadForFieldGrants(String objectApiName, String grantsJson) {
        List<InspectorNativeFlsGrant> grants = new List<InspectorNativeFlsGrant>();
        if (String.isNotBlank(grantsJson)) {
            grants = (List<InspectorNativeFlsGrant>) JSON.deserialize(grantsJson, List<InspectorNativeFlsGrant>.class);
        }
        if (grants.isEmpty()) {
            return;
        }

        Set<Id> permissionSetIds = new Set<Id>();
        // Only permission sets actually gaining new field-level access need object-level Read
        // ensured - a grant that's revoking access (both boxes unchecked) has no reason to touch
        // object-level access at all.
        Set<Id> permissionSetIdsNeedingObjectRead = new Set<Id>();
        for (InspectorNativeFlsGrant grant : grants) {
            if (String.isBlank(grant.permissionSetId)) {
                continue;
            }
            permissionSetIds.add(grant.permissionSetId);
            if (grant.readAccess == true || grant.editAccess == true) {
                permissionSetIdsNeedingObjectRead.add(grant.permissionSetId);
            }
        }
        if (permissionSetIdsNeedingObjectRead.isEmpty()) {
            return;
        }

        Map<Id, ObjectPermissions> existingByPermissionSetId = new Map<Id, ObjectPermissions>();
        for (ObjectPermissions existing : [
            SELECT Id, ParentId, PermissionsRead
            FROM ObjectPermissions
            WHERE SobjectType = :objectApiName AND ParentId IN :permissionSetIds
        ]) {
            existingByPermissionSetId.put(existing.ParentId, existing);
        }

        List<ObjectPermissions> toUpsert = new List<ObjectPermissions>();
        for (Id permissionSetId : permissionSetIdsNeedingObjectRead) {
            ObjectPermissions existing = existingByPermissionSetId.get(permissionSetId);
            if (existing != null) {
                // Only touched (and only upserted) when Read is actually missing - never clobbers
                // any other flag already set on an existing row.
                if (existing.PermissionsRead != true) {
                    existing.PermissionsRead = true;
                    toUpsert.add(existing);
                }
                continue;
            }
            ObjectPermissions newObjectPermission = new ObjectPermissions();
            newObjectPermission.ParentId = permissionSetId;
            newObjectPermission.SobjectType = objectApiName;
            newObjectPermission.PermissionsRead = true;
            toUpsert.add(newObjectPermission);
        }
        if (toUpsert.isEmpty()) {
            return;
        }

        try {
            upsert toUpsert;
        } catch (DmlException dmlError) {
            throw new AuraHandledException(
                'Error ensuring object-level read access: ' + dmlError.getMessage() + '. First grant attempted: ' + JSON.serialize(toUpsert[0])
            );
        }
    }

    // Confirmed live (not just theorized): a save reported "Success" with nothing persisted, and
    // the diagnostics below proved the client payload really was correct (permissionSetId present
    // and valid on every grant) while Apex still received it as unusable - the same shape as
    // Field Creator's still-unresolved deploy bug elsewhere in this app (see
    // salesforceInspectorNative/README.md), where a List<CustomType> parameter arrived with every
    // property null despite a confirmed-correct outgoing request. Renaming the method and
    // extracting the DTO to a top-level class (both already true here, and both already tried and
    // failed for Field Creator) didn't help there, so this takes a genuinely different approach
    // instead of repeating what's already known not to work: grants travel as a plain JSON string
    // and get parsed with JSON.deserialize() inside the method, bypassing whatever the automatic
    // List<T> action-parameter binding is doing wrong. If this turns out to fix it, the same
    // change is worth applying to Field Creator's own deployCustomFields too.
    @AuraEnabled
    public static void saveFieldPermissions(String objectApiName, String grantsJson, String objectGrantsJson) {
        List<InspectorNativeFlsGrant> grants = new List<InspectorNativeFlsGrant>();
        if (String.isNotBlank(grantsJson)) {
            grants = (List<InspectorNativeFlsGrant>) JSON.deserialize(grantsJson, List<InspectorNativeFlsGrant>.class);
        }
        List<InspectorNativeObjectPermissionGrant> objectGrants = new List<InspectorNativeObjectPermissionGrant>();
        if (String.isNotBlank(objectGrantsJson)) {
            objectGrants = (List<InspectorNativeObjectPermissionGrant>) JSON.deserialize(objectGrantsJson, List<InspectorNativeObjectPermissionGrant>.class);
        }

        if (grants.isEmpty() && objectGrants.isEmpty()) {
            return;
        }

        Set<Id> permissionSetIds = new Set<Id>();
        for (InspectorNativeFlsGrant grant : grants) {
            if (String.isNotBlank(grant.permissionSetId)) {
                permissionSetIds.add(grant.permissionSetId);
            }
        }
        for (InspectorNativeObjectPermissionGrant grant : objectGrants) {
            if (String.isNotBlank(grant.permissionSetId)) {
                permissionSetIds.add(grant.permissionSetId);
            }
        }
        if (permissionSetIds.isEmpty()) {
            // Apex's ternary operator won't unify two unrelated custom types (even assigning to
            // Object) - confirmed the hard way, not assumed - so this is a plain if/else instead
            // of the more compact ternary that would otherwise fit here.
            Object firstReceived;
            if (!grants.isEmpty()) {
                firstReceived = grants[0];
            } else {
                firstReceived = objectGrants[0];
            }
            throw new AuraHandledException('Received grant(s) with no usable permissionSetId. First grant as received: ' + JSON.serialize(firstReceived));
        }

        // Explicit object-level grants only here - the object-level Read a field grant might itself
        // depend on is ensured separately, before this method is ever called (see
        // ensureObjectReadForFieldGrants and the class doc comment for why that has to be a genuinely
        // separate, already-committed Apex transaction rather than an extra upsert folded in here).
        Map<Id, ObjectPermissions> existingObjectPermissionsByPermissionSetId = new Map<Id, ObjectPermissions>();
        if (!objectGrants.isEmpty()) {
            for (ObjectPermissions existing : [
                SELECT Id, ParentId
                FROM ObjectPermissions
                WHERE SobjectType = :objectApiName AND ParentId IN :permissionSetIds
            ]) {
                existingObjectPermissionsByPermissionSetId.put(existing.ParentId, existing);
            }
        }
        Map<Id, ObjectPermissions> objectPermissionsToUpsertByPermissionSetId = new Map<Id, ObjectPermissions>();

        List<FieldPermissions> toUpsertFields = new List<FieldPermissions>();
        List<FieldPermissions> toDeleteFields = new List<FieldPermissions>();
        if (!grants.isEmpty()) {
            Map<String, FieldPermissions> existingByKey = new Map<String, FieldPermissions>();
            for (FieldPermissions existing : [
                SELECT Id, ParentId, Field
                FROM FieldPermissions
                WHERE SobjectType = :objectApiName AND ParentId IN :permissionSetIds
            ]) {
                existingByKey.put(existing.ParentId + '.' + existing.Field, existing);
            }

            Integer skippedForBlankFields = 0;
            for (InspectorNativeFlsGrant grant : grants) {
                if (String.isBlank(grant.fieldApiName) || String.isBlank(grant.permissionSetId)) {
                    skippedForBlankFields++;
                    continue;
                }
                String fullFieldName = objectApiName + '.' + grant.fieldApiName;
                String key = grant.permissionSetId + '.' + fullFieldName;
                FieldPermissions existing = existingByKey.get(key);
                Boolean wantsAnyAccess = grant.readAccess == true || grant.editAccess == true;

                if (!wantsAnyAccess) {
                    if (existing != null) {
                        toDeleteFields.add(existing);
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
                toUpsertFields.add(fieldPermission);
            }

            if (skippedForBlankFields == grants.size()) {
                throw new AuraHandledException(
                    'Received ' + grants.size() + ' field grant(s), but every one had a blank fieldApiName or permissionSetId. First grant as received: '
                        + JSON.serialize(grants[0])
                );
            }
        }

        if (!objectGrants.isEmpty()) {
            Integer skippedForBlankPermissionSet = 0;
            for (InspectorNativeObjectPermissionGrant grant : objectGrants) {
                if (String.isBlank(grant.permissionSetId)) {
                    skippedForBlankPermissionSet++;
                    continue;
                }
                ObjectPermissions objectPermission = existingObjectPermissionsByPermissionSetId.get(grant.permissionSetId);
                if (objectPermission == null) {
                    objectPermission = new ObjectPermissions();
                    objectPermission.ParentId = grant.permissionSetId;
                    objectPermission.SobjectType = objectApiName;
                }
                // Same cascading dependencies the client already enforces before a click ever gets
                // here (see toggleObjectPermissionState) - re-applied here too, so a save can never
                // leave an inconsistent combination in the database even if it somehow got past the
                // client (e.g. a stale payload).
                objectPermission.PermissionsModifyAllRecords = grant.modifyAllAccess == true;
                objectPermission.PermissionsDelete = grant.deleteAccess == true || objectPermission.PermissionsModifyAllRecords;
                objectPermission.PermissionsEdit = grant.editAccess == true || objectPermission.PermissionsDelete;
                objectPermission.PermissionsViewAllRecords = grant.viewAllAccess == true;
                objectPermission.PermissionsRead = grant.readAccess == true || objectPermission.PermissionsEdit || objectPermission.PermissionsViewAllRecords;
                objectPermission.PermissionsCreate = grant.createAccess == true;
                objectPermissionsToUpsertByPermissionSetId.put(grant.permissionSetId, objectPermission);
            }

            if (skippedForBlankPermissionSet == objectGrants.size()) {
                throw new AuraHandledException(
                    'Received ' + objectGrants.size() + ' object grant(s), but every one had a blank permissionSetId. First grant as received: '
                        + JSON.serialize(objectGrants[0])
                );
            }
        }

        List<ObjectPermissions> toUpsertObjects = objectPermissionsToUpsertByPermissionSetId.values();

        // Uncaught, this DML would surface to the client as a generic "Unknown error" - Salesforce
        // masks non-AuraHandledException exceptions from @AuraEnabled methods by default, hiding
        // the real reason (confirmed the hard way).
        //
        // Split into two separate try/catch blocks (not one shared one) specifically so a failure
        // says which statement actually threw and echoes back the first row it was trying to write -
        // a single shared catch left that genuinely ambiguous (INVALID_CROSS_REFERENCE_KEY on "row
        // 0" doesn't say which list row 0 refers to), and guessing at that instead of just answering
        // it directly is exactly the kind of unverified assumption this app's own history warns
        // against.
        if (!toUpsertObjects.isEmpty()) {
            try {
                upsert toUpsertObjects;
            } catch (DmlException dmlError) {
                throw new AuraHandledException(
                    'Error saving object-level permissions: ' + dmlError.getMessage()
                        + '. First object grant attempted: ' + JSON.serialize(toUpsertObjects[0])
                );
            }
        }
        try {
            if (!toUpsertFields.isEmpty()) {
                upsert toUpsertFields;
            }
            if (!toDeleteFields.isEmpty()) {
                delete toDeleteFields;
            }
        } catch (DmlException dmlError) {
            // The object-level-Read theory (two separate, confirmed-committed Apex transactions,
            // via ensureObjectReadForFieldGrants) was confirmed live NOT to be the cause - the
            // identical INVALID_CROSS_REFERENCE_KEY error still happened even with Read genuinely
            // already committed beforehand. Rather than theorize a fourth time, this echoes back
            // what the target PermissionSet record itself actually is - Type in particular, since
            // getAssignablePermissionSets() (InspectorNativeFieldPermissions) only filters on
            // IsOwnedByProfile, not Type, and a non-'Regular' PermissionSet (e.g. the internal
            // aggregate record behind a Permission Set Group) is a real, valid Id that may still
            // reject direct FieldPermissions/ObjectPermissions DML.
            String targetPermissionSetId = !toUpsertFields.isEmpty() ? toUpsertFields[0].ParentId : toDeleteFields[0].ParentId;
            String targetPermissionSetContext = 'no matching PermissionSet record found for Id ' + targetPermissionSetId;
            List<PermissionSet> targetPermissionSets = [SELECT Id, Name, Label, Type, IsOwnedByProfile FROM PermissionSet WHERE Id = :targetPermissionSetId];
            if (!targetPermissionSets.isEmpty()) {
                targetPermissionSetContext = 'target PermissionSet: ' + JSON.serialize(targetPermissionSets[0]);
            }
            throw new AuraHandledException(
                'Error saving field-level permissions: ' + dmlError.getMessage()
                    + '. First field grant attempted: '
                    + (!toUpsertFields.isEmpty() ? JSON.serialize(toUpsertFields[0]) : JSON.serialize(toDeleteFields[0]))
                    + '. ' + targetPermissionSetContext
            );
        }
    }

    private class FieldOptionByLabel implements Comparator<FieldOption> {
        public Integer compare(FieldOption a, FieldOption b) {
            return a.label.compareTo(b.label);
        }
    }
}
