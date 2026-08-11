/**
 * One permission set's Read/Edit selection for a field, for InspectorNativeFieldPermissions.
 * grantFieldPermissions. Deliberately a top-level class, not nested inside
 * InspectorNativeFieldPermissions - same reasoning as InspectorNativeFieldSpec: Apex inner classes
 * aren't reliable as List<T> *parameter* types for LWC-invoked methods (confirmed directly on that
 * class; fixed proactively here too before it caused the same silent-null-properties symptom).
 */
public class InspectorNativeFieldPermissionGrant {
    @AuraEnabled
    public String permissionSetId;
    @AuraEnabled
    public Boolean readAccess;
    @AuraEnabled
    public Boolean editAccess;
}
