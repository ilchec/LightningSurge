/**
 * One permission set's desired object-level access on the FLS Matrix's object, for
 * InspectorNativeFlsMatrix.saveFieldPermissions. A plain top-level DTO, not nested inside
 * InspectorNativeFlsMatrix - same reasoning as InspectorNativeFlsGrant/InspectorNativeFieldSpec
 * elsewhere in this app: Apex inner classes aren't reliable as List<T> *parameter* types for
 * LWC-invoked methods.
 */
public class InspectorNativeObjectPermissionGrant {
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
