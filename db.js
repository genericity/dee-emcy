// We want to run commands synchronously for simplicity but base sqlite3
// is all asynchronous. We can't use async/await because the node-sqlite3 
// library does not support the Promise API. So we use better-sqlite3
// instead for synchronous calls.
const sqlite3 = require('better-sqlite3');
const winston = require('winston');

class SqliteDatabase {
	constructor(filename, schema = null) {
		this.filename = filename;
		this.db = new sqlite3(filename);

		if (schema !== null) {
			this.initTables(schema);
		}
	}

	/**
	* Creates a database connection which supports Promises.
	* @param {string} filename The filename for the database.
	* @return {Promise} A promise which resolves to a database connection.
	*/
	createDbConnection(filename) {
	    return open({
	        filename,
	        'driver': sqlite3.Database
	    });
	}

	/**
	* To protect against names/values with hyphens.
	* Conventionally, in SQLite there should be double quotes around column names
	* and single quotes around strings.
	* 
	* @param {string|number} k The name to protect.
	* @param {!boolean} isColumn Whether to use double quotes or single.
	* @return {string|number} Double-quoted string or the original number.
	*/
	quote(k, isColumn = true) {
		const quotes = isColumn ? '"' : '';
		if (typeof k === 'string') {
			k = isColumn ? k : escape(k);
			return quotes + k + quotes;
		} else if (k === null) {
			return "null";
		} else if (k === true) {
			// better-sqlite3 disallows true/false as booleans.
			return 1;
		} else if (k === false) {
			return 0;
		} else {
			return k;
		}
	}


	/**
	* Unescapes all values in an object.
	*
	* @param {!Object} obj The object to unescape.
	* @return{!Object} The unescaped object.
	*/
	dequoteAll(obj) {
		if (!obj) {
			return obj;
		}
		return Object.fromEntries(Object.entries(obj).map(([k, v]) => {
			if (typeof v === 'string') {
				v = unescape(v);
			}
			return [k, v];
		}));
	}

	/**
	* Wraps each item in the array in quotes if it is a string.
	* 
	* @param {!Array<string|number>} arr An array of values to protect.
	* @param {!boolean} isColumn Whether to use double quotes or single.
	* @return {!Array<string|number>} Array of quoted strings or the original items.
	*/
	quoteAll(arr, isColumn = true) {
		return arr.map((v) => {
			return this.quote(v, isColumn);
		});
	}

	/**
	* Initializes the database tables according to the given schema.
	* Expected schema is an array of objects, with a tableName property and 
	* a columns property, which is an array of tuples of column name and data type.
	* e.g.
	* [{
	*    tableName: 'questions',
	*    columns: [['author', 'NUMERIC'], ['questionText', 'TEXT']]
	* }]
	* 
	* @param {!Array<!Object>} schema
	*/
	initTables(schema) {
		this.db.prepare('BEGIN EXCLUSIVE TRANSACTION;').run();
		for (let table of schema) {
			const name = table.tableName;
			// Create the table.
			// Wrap the column name in quotes and join together.
			const flattenedColumns = table.columns.map((v) => {
				v[0] = this.quote(v[0]);
				return v.join(' ');
			});
			const columnString = flattenedColumns.join(', ');
			this.db.prepare(`CREATE TABLE IF NOT EXISTS "${name}" (${columnString});`).run();
			winston.info(`CREATE TABLE IF NOT EXISTS "${name}" (${columnString});`);
		}
		// Attempt to commit everything.
		// We can't use a try/catch because sqlite3 errors are not thrown by this command.
		// However, all previous changes will only be permanent if this succeeds. Therefore
		// no changes will be saved unless all changes are able to saved.
		this.db.prepare('COMMIT TRANSACTION;').run();
	}

	/**
	* Flattens an object.
	* https://stackoverflow.com/questions/44134212/best-way-to-flatten-js-object-keys-and-values-to-a-single-depth-array
	*
	* @param {!Object} obj The object to flatten (recursively).
	* @param {string} parent Name of the parent of the object.
	* @param {?Object} res Intermediate result.
	* @return {!Object} The flattened object.
	*/
	flattenObj(obj, parent, res = {}){
		for(let key in obj){
		    let propName = parent ? parent + '_' + key : key;
		    if(typeof obj[key] == 'object' && obj[key] !== null){
		        this.flattenObj(obj[key], propName, res);
		    } else {
		        res[propName] = obj[key];
		    }
		}
		return res;
	}

	/**
	* Constructs a string out of an object, flattening it to a sequence of
	* key-value pairs.
	* e.g. {'name': 'John', 'age': 20} =>
	* 'name = John AND age = 20'
	*
	* @param {!Object} params The object to flatten into a string.
	* @param {string} joiner Joiner between key-value pairs.
	* @param {string} kvJoiner Joiner inside key-value pairs.
	* @return {string} Joined string.
	*/
	buildKeyValueString(params, joiner = ' AND ', kvJoiner = '=') {
		const flattenedItem = this.flattenObj(params);
		// We're aiming to parametize this.
		const paramString = Object.entries(flattenedItem).map(([k, v]) => this.quote(k) + kvJoiner + this.quote(v, false));
		return paramString.join(joiner);
	}

	/**
	* Constructs a string out of an object for parameter entry.
	* e.g. {'name': 'John', 'age': 20} =>
	* 'name = @name AND age = @age'
	*
	* @param {!Object} params The object to flatten into a string.
	* @param {string} joiner Joiner between key-value pairs.
	* @param {string} kvJoiner Joiner inside key-value pairs.
	* @return {string} Joined string.
	*/
	buildParamString(params, joiner = ' AND ', kvJoiner = ' = ?') {
		const flattenedItem = this.flattenObj(params);
		// We're aiming to parametize this.
		const paramString = Object.entries(flattenedItem).map(([k, v]) => this.quote(k) + kvJoiner );
		return paramString.join(joiner);
	}

	/**
	* Builds an insertion query.
	*
	* @param {!string} table The name of the table to insert into.
	* @param {?Object} params A dictionary of column names to values to use as parameters.
	* @return {string} The insertion query string.
	*/
	buildInsertQuery(table, params) {
		const flattenedItem = this.flattenObj(params);
		const columnNamesString = this.quoteAll(Object.keys(flattenedItem)).join(', ');
		const dataString = Object.keys(flattenedItem).map(k => '?').join(', '); // this.quoteAll(Object.values(flattenedItem), false).join(', ');
		const insertionString = `INSERT INTO "${table}" (${columnNamesString}) VALUES (${dataString});`;
		return insertionString;
	}

	/**
	* Builds a select query.
	*
	* @param {!string} table The name of the table to select.
	* @param {?Object} params A dictionary of column names to values to use as parameters.
	* @return {string} The select query string.
	*/
	buildSelectQuery(table, params) {
		const whereString = this.buildParamString(params);
		if (whereString) {
			return `SELECT * FROM "${table}" WHERE ${whereString};`;
		} else {
			return `SELECT * FROM "${table}";`;
		}
	}

	/**
	* Builds an update query.
	*
	* @param {!string} table The name of the table to update.
	* @param {?Object} valueParams A dictionary of column names to values to update.
	* @param {?Object} whereParams A dictionary of column names to values to find items.
	* @return {string} The update query string.
	*/
	buildUpdateQuery(table, valueParams, whereParams = {}) {
		const flattenedValues = this.flattenObj(valueParams);
		const flattenedWhere = this.flattenObj(whereParams);
		const valueString = this.buildParamString(flattenedValues, ', ');
		const whereString = this.buildParamString(flattenedWhere);
		if (whereString) {
			return `UPDATE "${table}" SET ${valueString} WHERE ${whereString};`;
		} else {
			return `UPDATE "${table}" SET ${valueString}";`;
		}
	}

	/**
	* @param {!string} table The name of the table to insert into.
	* @param {?Object} params A dictionary of column names to values to insert.
	*/
	insert(table, params = {}) {
		const query = this.buildInsertQuery(table, params);
		const prepared = this.db.prepare(query);
		winston.info('INSERT:', prepared);
		const values = this.quoteAll(Object.values(this.flattenObj(params)), false);

		// Ensure commits are finished before closing.
		this.db.prepare('BEGIN TRANSACTION;').run();
		const info = prepared.run(...values);
		this.db.prepare('COMMIT TRANSACTION;').run();

		winston.info(info);
		return info;
	}

	/**
	* @param {!string} table The name of the table to select from.
	* @param {?Object} params A dictionary of column names to values to use as parameters.
	* @return {Promise} A promise that resolves into multiple rows of results of the
	*   select query.
	*/
	find(table, params = {}) {
		const query = this.buildSelectQuery(table, params);
		const prepared = this.db.prepare(query);
		winston.info('FIND:', prepared);
		const values = this.quoteAll(Object.values(this.flattenObj(params)), false);
		return prepared.all(...values).map(row => this.dequoteAll(row));
	}

	/**
	* @param {!string} table The name of the table to select from.
	* @param {?Object} params A dictionary of column names to values to use as parameters.
	* @return {Promise} A promise that resolves into one row of results of the select
	*   query.
	*/
	findOne(table, params = {}) {
		const query = this.buildSelectQuery(table, params);
		const prepared = this.db.prepare(query);
		winston.info('FINDONE:', prepared);
		const values = this.quoteAll(Object.values(this.flattenObj(params)), false);
		return this.dequoteAll(prepared.get(...values));
	}

	/**
	* @param {!string} table The name of the table to update.
	* @param {?Object} valueParams A dictionary of column names to values to update.
	* @param {?Object} whereParams A dictionary of column names to values to find items.
	* @return {Promise} A promise that resolves into an error if there exists an error.
	*/
	update(table, valueParams, whereParams) {
		const query = this.buildUpdateQuery(table, valueParams, whereParams);
		const prepared = this.db.prepare(query);
		winston.info('UPDATE:', prepared);
		const params = Object.assign(
			this.flattenObj(valueParams),
			this.flattenObj(whereParams));
		const values = this.quoteAll(Object.values(this.flattenObj(params)), false);

		this.db.prepare('BEGIN TRANSACTION;').run();
		const info = prepared.run(...values);
		this.db.prepare('COMMIT TRANSACTION;').run();

		winston.info(info);
		return info;
	}

	/**
	* @param {!string} table The name of the table to update.
	* @param {?Object} valueParams A dictionary of column names to values to update.
	* @param {?Object} whereParams A dictionary of column names to values to find items.
	* @return {Promise} A promise that resolves into an error if there exists an error.
	*/
	atomicQuery(queries) {
		// Eensure each query is run atomically and in sequence.
		this.db.prepare('BEGIN EXCLUSIVE TRANSACTION;').run();
		for (query of queries) {
			winston.info('QUERY:', query);
			const info = this.db.prepare(query).run();
			winston.info(info);
		}
		this.db.prepare('COMMIT TRANSACTION;').run();
	}
}

exports.SqliteDatabase = SqliteDatabase;