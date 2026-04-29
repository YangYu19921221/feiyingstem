.headers on
.mode column

SELECT 'book_assignments columns' AS check_name;
PRAGMA table_info(book_assignments);

SELECT 'homework_assignments has group_index' AS check_name;
SELECT name FROM pragma_table_info('homework_assignments') WHERE name='group_index';

SELECT 'class_students has is_active and left_at' AS check_name;
SELECT name FROM pragma_table_info('class_students') WHERE name IN ('is_active','left_at');

SELECT 'unique active student index exists' AS check_name;
SELECT name FROM sqlite_master WHERE type='index' AND name='uq_active_student';

SELECT 'old book_assignments rows count preserved' AS check_name;
SELECT COUNT(*) AS new_count FROM book_assignments;

SELECT 'partial unique indexes for book_assignments' AS check_name;
SELECT name FROM sqlite_master WHERE type='index' AND name IN ('uq_assign_book','uq_assign_unit','uq_assign_group');
