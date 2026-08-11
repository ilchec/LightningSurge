/**
 * One field to create, for Field Creator's InspectorNativeFieldCreator.deployFields. Deliberately a
 * top-level class, not an inner class of InspectorNativeFieldCreator - confirmed the hard way that
 * Apex inner classes are not reliably usable as List<T> *parameter* types for methods called
 * imperatively from LWC (every property silently arrives null, even though the client sends a
 * correctly-formed payload - verified directly by logging both ends of the same call). Inner
 * classes work fine as *return* types (every other DTO in this app is one), just not as inputs.
 */
public class InspectorNativeFieldSpec {
    @AuraEnabled
    public String objectApiName;
    @AuraEnabled
    public String label;
    @AuraEnabled
    public String fieldApiName; // without the __c suffix - appended in buildFullName
    @AuraEnabled
    public String fieldType; // one of Text/LongTextArea/Checkbox/Number/Currency/Percent/Date/DateTime/Email/Phone/Url/Picklist
    @AuraEnabled
    public Integer length;
    @AuraEnabled
    public Integer precision;
    @AuraEnabled
    public Integer scale;
    @AuraEnabled
    public Integer visibleLines;
    @AuraEnabled
    public Boolean isRequired;
    @AuraEnabled
    public String description;
    @AuraEnabled
    public String helpText;
    @AuraEnabled
    public Boolean isUnique;
    @AuraEnabled
    public Boolean isExternalId;
    @AuraEnabled
    public List<String> picklistValues;
}
