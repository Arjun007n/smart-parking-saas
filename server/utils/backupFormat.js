const mongoose = require("mongoose");

const { EJSON } = mongoose.mongo.BSON;

// One document per line, in MongoDB's Extended JSON. Unlike plain JSON this
// keeps ids, dates and number types exactly, so a restore is a true copy.
const serialize = (doc) => EJSON.stringify(doc, { relaxed: false });
const parse = (line) => EJSON.parse(line, { relaxed: false });

// "smart_parking" from a connection string.
const databaseName = (uri) => {
  const path = new URL(String(uri).replace(/^mongodb(\+srv)?:/, "http:")).pathname.slice(1);
  return decodeURIComponent(path);
};

module.exports = { serialize, parse, databaseName };
