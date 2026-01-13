const fs = require('fs-extra');

const log = new (require('./AppLogger'))().log;//singleton

const emptyFieldValue = '?';

/**
 * DbFilter - модуль для фильтрации уже созданной БД
 * Применяется на клиенте после скачивания master БД с сервера
 */
class DbFilter {
    constructor(config, db) {
        this.config = config;
        this.db = db;
    }

    /**
     * Загружает фильтр из filter.json
     */
    async loadFilter() {
        const inpxFilterFile = this.config.inpxFilterFile;

        if (!await fs.pathExists(inpxFilterFile)) {
            return null;
        }

        let filter = await fs.readFile(inpxFilterFile, 'utf8');
        filter = JSON.parse(filter);

        if (filter.includeAuthors) {
            filter.includeAuthors = filter.includeAuthors.map(a => a.toLowerCase());
            filter.includeSet = new Set(filter.includeAuthors);
        }

        if (filter.excludeAuthors) {
            filter.excludeAuthors = filter.excludeAuthors.map(a => a.toLowerCase());
            filter.excludeSet = new Set(filter.excludeAuthors);
        }

        return filter;
    }

    /**
     * Проверяет книгу на соответствие фильтру
     */
    checkFilter(book, filter) {
        if (!filter) return true;

        let author = book.author;
        if (!author) author = emptyFieldValue;

        author = author.toLowerCase();

        // Если есть includeAuthors - книга должна быть в этом списке
        if (filter.includeSet) {
            // Проверяем все авторы книги (может быть несколько через запятую)
            const authors = author.split(',').map(a => a.trim());
            const hasIncluded = authors.some(a => filter.includeSet.has(a));
            if (!hasIncluded) return false;
        }

        // Если есть excludeAuthors - книги из этого списка исключаются
        if (filter.excludeSet) {
            const authors = author.split(',').map(a => a.trim());
            const hasExcluded = authors.some(a => filter.excludeSet.has(a));
            if (hasExcluded) return false;
        }

        // Custom filter (если allowUnsafeFilter)
        if (filter.filter) {
            if (this.config.allowUnsafeFilter) {
                const customFilter = new Function(`'use strict'; return ${filter.filter}`)();
                if (!customFilter(book)) return false;
            } else {
                throw new Error(`Unsafe property 'filter' detected in ${this.config.inpxFilterFile}. Please specify '--unsafe-filter' param if you know what you're doing.`);
            }
        }

        return true;
    }

    /**
     * Применяет фильтр к уже существующей БД
     * Удаляет ненужные книги и пересчитывает индексы
     */
    async filterExistingDb() {
        const filter = await this.loadFilter();

        if (!filter) {
            log(LM_INFO,'No filter found, skipping filtering');
            return;
        }

        log(LM_INFO,'Applying filter to downloaded DB...');

        await this.db.open({table: 'book'});

        // Собираем ID книг для удаления
        const deletedIds = [];
        const bookRows = await this.db.select({table: 'book'});

        for (const book of bookRows) {
            if (!this.checkFilter(book, filter)) {
                deletedIds.push(book.id);
            }
        }

        if (deletedIds.length === 0) {
            log(LM_INFO,'No books to filter out');
            return;
        }

        log(LM_INFO,`Filtering out ${deletedIds.length} books...`);

        // Удаляем книги из таблицы book
        await this.db.delete({
            table: 'book',
            where: `@@id(${this.db.esc(deletedIds)})`
        });

        // Пересчитываем индексы
        await this.rebuildIndexes(deletedIds);

        // Vacuum для освобождения места
        log(LM_INFO,'Vacuuming database...');
        await this.db.vacuum();

        log(LM_INFO,'Filter applied successfully');
    }

    /**
     * Пересчитывает индексы после удаления книг
     */
    async rebuildIndexes(deletedIds) {
        log(LM_INFO,'Rebuilding indexes...');

        const deletedSet = new Set(deletedIds);

        // Обновляем таблицы author, series, title
        for (const tableName of ['author', 'series', 'title']) {
            await this.db.open({table: tableName});

            const rows = await this.db.select({table: tableName});
            const toDelete = [];
            const toUpdate = [];

            for (const row of rows) {
                // Фильтруем bookIds - удаляем ID удаленных книг
                const newBookIds = row.bookIds.filter(id => !deletedSet.has(id));

                if (newBookIds.length === 0) {
                    // Если нет книг - удаляем запись из индекса
                    toDelete.push(row.id);
                } else if (newBookIds.length !== row.bookIds.length) {
                    // Если количество изменилось - обновляем запись
                    toUpdate.push({
                        id: row.id,
                        bookIds: newBookIds,
                        bookCount: newBookIds.length
                    });
                }
            }

            // Удаляем пустые записи
            if (toDelete.length > 0) {
                await this.db.delete({
                    table: tableName,
                    where: `@@id(${this.db.esc(toDelete)})`
                });
            }

            // Обновляем записи с новым количеством книг
            for (const item of toUpdate) {
                await this.db.update({
                    table: tableName,
                    where: `@@id(${item.id})`,
                    set: {
                        bookIds: item.bookIds,
                        bookCount: item.bookCount
                    }
                });
            }

            log(LM_INFO,`${tableName}: removed ${toDelete.length} empty entries, updated ${toUpdate.length} entries`);
        }
    }
}

module.exports = DbFilter;
