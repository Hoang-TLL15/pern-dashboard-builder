// src/controllers/reportController.js
// Lớp controller — chỉ chịu trách nhiệm nhận req, gọi service tương ứng,
// và trả về res. Không chứa business logic hay query DB.
const reportService = require('../services/reportService');

async function list(req, res, next) {
  try {
    const reports = await reportService.list(req.user.id);
    return res.json({ reports });
  } catch (err) {
    return next(err);
  }
}

async function getById(req, res, next) {
  try {
    const report = await reportService.getById(req.params.id, req.user.id);
    return res.json({ report });
  } catch (err) {
    return next(err);
  }
}

async function create(req, res, next) {
  try {
    const report = await reportService.create(req.user.id, req.body);
    return res.status(201).json({ report });
  } catch (err) {
    return next(err);
  }
}

async function update(req, res, next) {
  try {
    const report = await reportService.update(req.params.id, req.user.id, req.body);
    return res.json({ report });
  } catch (err) {
    return next(err);
  }
}

async function remove(req, res, next) {
  try {
    await reportService.remove(req.params.id, req.user.id);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

async function updateFilterValues(req, res, next) {
  try {
    await reportService.updateFilterValues(req.params.id, req.user.id, req.body.filterValues);
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  list,
  getById,
  create,
  update,
  updateFilterValues,
  remove,
};
