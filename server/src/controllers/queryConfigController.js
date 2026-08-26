// src/controllers/queryConfigController.js
// Lớp controller — chỉ chịu trách nhiệm nhận req, gọi service tương ứng,
// và trả về res. Không chứa business logic hay query DB.
const queryConfigService = require('../services/queryConfigService');

async function listByDbConnectionId(req, res, next) {
  try {
    const queryConfigs = await queryConfigService.listByDbConnectionId(req.params.id);
    return res.json({ queryConfigs });
  } catch (err) {
    return next(err);
  }
}

async function run(req, res, next) {
  try {
    const result = await queryConfigService.run(req.params.id);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function runMany(req, res, next) {
  try {
    const results = await queryConfigService.runMany(req.body.ids || [], req.body.filters || {});
    return res.json({ results });
  } catch (err) {
    return next(err);
  }
}

async function preview(req, res, next) {
  try {
    const result = await queryConfigService.previewQuery(req.params.id, req.body.query);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const queryConfig = await queryConfigService.create(req.body);
    return res.status(201).json({ queryConfig });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const queryConfig = await queryConfigService.update(req.params.id, req.body);
    return res.json({ queryConfig });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    await queryConfigService.remove(req.params.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  listByDbConnectionId,
  run,
  runMany,
  preview,
  create,
  update,
  remove,
};
