BEGIN;

-- Explicitly ensure any remaining NULLs are caught (fails safely if you missed one)
-- or fallback to a dynamically generated string if appropriate:
UPDATE businesses 
SET email = 'migrated_user_' || id || '@example.com' 
WHERE email IS NULL;

-- Make the column required
ALTER TABLE businesses ALTER COLUMN email SET NOT NULL;

COMMIT;