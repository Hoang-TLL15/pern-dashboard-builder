// src/controllers/dbConnectionController.js
// Lớp controller — chỉ chịu trách nhiệm nhận req, gọi service tương ứng,
// và trả về res. Không chứa business logic hay query DB.
const dbConnectionService = require('../services/dbConnectionService');

async function list(req, res, next) {
  try {
    const connections = await dbConnectionService.list();
    return res.json({ connections });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const connection = await dbConnectionService.getById(req.params.id);
    return res.json({ connection });
  } catch (err) {
    return next(err);
  }
}

async function getSchema(req, res, next) {
  try {
    const schema = await dbConnectionService.getSchema(req.params.id);
    return res.json({ schema });
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  list,
  getById,
  getSchema,
};
