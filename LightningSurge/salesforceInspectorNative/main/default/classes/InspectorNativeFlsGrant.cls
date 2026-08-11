/**
 * One (field, permission set) cell's desired Read/Edit state, for
 * InspectorNativeFlsMatrix.saveFieldPermissions. A plain top-level DTO, not nested inside
 * InspectorNativeFlsMatrix - same reasoning as InspectorNativeFieldSpec/
 * InspectorNativeFieldPermissionGrant elsewhere in this app: Apex inner classes aren't reliable as
 * List<T> *parameter* types for LWC-invoked methods.
 */
public class InspectorNativeFlsGrant {
    @AuraEnabled
    public String fieldApiName;
    @AuraEnabled
    public String permissionSetId;
    @AuraEnabled
    public Boolean readAccess;
    @AuraEnabled
    public Boolean editAccess;
}
