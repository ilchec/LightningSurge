/**
 * Backs the Record Access Inspector tab: "why can/can't user X see record Y", using
 * UserRecordAccess - the platform's own purpose-built object for exactly this question, confirmed
 * directly against the official object reference rather than assumed. UserRecordAccess is
 * read-only and has real, enforced query constraints: the WHERE clause must filter on a single
 * UserId and a single RecordId (or an IN list of RecordIds), and only RecordId, the Has*Access
 * fields, and MaxAccessLevel can be selected - no other fields, no Id. RecordId must also be
 * explicitly in the SELECT list even though it's already pinned to one value in the WHERE clause -
 * a real requirement the platform enforces at deploy/compile time (confirmed the hard way, not
 * documented anywhere checked beforehand) - leaving it out fails the whole query.
 *
 * Not included: HasAllAccess, sometimes mentioned alongside the fields used here - it wasn't
 * confirmed with the same confidence as HasReadAccess/HasEditAccess/HasDeleteAccess/
 * HasTransferAccess/MaxAccessLevel, and a wrong field name would fail the whole query rather than
 * degrade gracefully, so it's left out rather than guessed at.
 *
 * A meaningful result also depends on the *running* user (whoever is using this tool) being able
 * to see the record themselves - UserRecordAccess only reports on records visible to the querying
 * context, same as `with sharing` everywhere else in this app. See the tab's own README section
 * for that caveat spelled out for the person using it.
 */
public with sharing class InspectorNativeRecordAccess {
    public class AccessResult {
        @AuraEnabled
        public String objectLabel;
        @AuraEnabled
        public String maxAccessLevel;
        @AuraEnabled
        public Boolean hasReadAccess;
        @AuraEnabled
        public Boolean hasEditAccess;
        @AuraEnabled
        public Boolean hasDeleteAccess;
        @AuraEnabled
        public Boolean hasTransferAccess;
    }

    @AuraEnabled
    public static AccessResult getRecordAccess(String recordId, String userId) {
        Id parsedRecordId;
        try {
            parsedRecordId = Id.valueOf(recordId);
        } catch (Exception e) {
            throw new AuraHandledException('"' + recordId + '" is not a valid record Id.');
        }

        AccessResult result = new AccessResult();
        result.objectLabel = parsedRecordId.getSObjectType().getDescribe().getLabel();

        List<UserRecordAccess> rows = [
            SELECT RecordId, MaxAccessLevel, HasReadAccess, HasEditAccess, HasDeleteAccess, HasTransferAccess
            FROM UserRecordAccess
            WHERE UserId = :userId AND RecordId = :parsedRecordId
        ];

        if (rows.isEmpty()) {
            // No row back from UserRecordAccess means "no access" - it doesn't omit rows for
            // access levels below some threshold, every visible-to-the-running-user record gets
            // exactly one row per user queried.
            result.maxAccessLevel = 'None';
            result.hasReadAccess = false;
            result.hasEditAccess = false;
            result.hasDeleteAccess = false;
            result.hasTransferAccess = false;
        } else {
            UserRecordAccess row = rows[0];
            result.maxAccessLevel = row.MaxAccessLevel;
            result.hasReadAccess = row.HasReadAccess;
            result.hasEditAccess = row.HasEditAccess;
            result.hasDeleteAccess = row.HasDeleteAccess;
            result.hasTransferAccess = row.HasTransferAccess;
        }
        return result;
    }
}
