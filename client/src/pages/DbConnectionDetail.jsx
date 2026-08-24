import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import dbConnectionService from '../services/dbConnectionService';
import queryConfigService from '../services/queryConfigService';
import ChartRenderer from '../components/ChartRenderer';
import ErdDiagram from '../components/ErdDiagram';
import Spinner from '../components/Spinner';
import { getApplicableChartTypes, pickChartType } from '../charts/chartAdapter';

export default function DbConnectionDetail() {
  const { id } = useParams();
  const { user, logout } = useAuth();
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [queryConfigs, setQueryConfigs] = useState([]);
  const [queryConfigsError, setQueryConfigsError] = useState('');
  const [queryConfigsLoading, setQueryConfigsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [runError, setRunError] = useState('');
  const [runLoading, setRunLoading] = useState(false);
  const [chartType, setChartType] = useState(null);
  const [schema, setSchema] = useState(null);
  const [schemaError, setSchemaError] = useState('');
  const [schemaLoading, setSchemaLoading] = useState(false);
  const [adHocSql, setAdHocSql] = useState('');
  const [previewResult, setPreviewResult] = useState(null);
  const [previewChartType, setPreviewChartType] = useState('table');
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [saveForm, setSaveForm] = useState(null);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState(null);
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function fetchConnection() {
      setLoading(true);
      setError('');
      try {
        const data = await dbConnectionService.getById(id);
        if (!cancelled) setConnection(data);
      } catch (err) {
        if (!cancelled) {
          setError(err.response?.data?.error || 'Không tải được kết nối');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchConnection();
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    let cancelled = false;

    async function fetchQueryConfigs() {
      setQueryConfigsLoading(true);
      setQueryConfigsError('');
      try {
        const data = await queryConfigService.listByDbConnectionId(id);
        if (!cancelled) setQueryConfigs(data);
      } catch (err) {
        if (!cancelled) {
          setQueryConfigsError(err.response?.data?.error || 'Không tải được danh sách query');
        }
      } finally {
        if (!cancelled) setQueryConfigsLoading(false);
      }
    }

    fetchQueryConfigs();
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleToggleSchema(e) {
    if (!e.target.open || schema || schemaLoading) return;
    setSchemaLoading(true);
    setSchemaError('');
    try {
      setSchema(await dbConnectionService.getSchema(id));
    } catch (err) {
      setSchemaError(err.response?.data?.error || 'Không tải được schema');
    } finally {
      setSchemaLoading(false);
    }
  }

  async function handleSelectQueryConfig(queryConfigId) {
    setSelectedId(queryConfigId);
    setPreviewResult(null);
    setPreviewError('');
    setSaveForm(null);
    setEditForm(null);
    setEditError('');
    setRunResult(null);
    setRunError('');
    setRunLoading(true);
    try {
      const data = await queryConfigService.run(queryConfigId);
      setRunResult(data);
      setChartType(pickChartType(data, data.suggestedChartType));
    } catch (err) {
      setRunError(err.response?.data?.error || 'Không chạy được query');
    } finally {
      setRunLoading(false);
    }
  }

  async function handlePreviewSql() {
    setSelectedId(null);
    setPreviewResult(null);
    setPreviewError('');
    setSaveForm(null);
    setPreviewLoading(true);
    try {
      const data = await queryConfigService.preview(id, adHocSql);
      setPreviewResult(data);
      setPreviewChartType(pickChartType(data, 'table'));
    } catch (err) {
      setPreviewError(err.response?.data?.error || 'Không chạy được SQL');
    } finally {
      setPreviewLoading(false);
    }
  }

  function handleOpenSaveForm() {
    setSaveForm({ name: '', description: '', suggestedChartType: previewChartType });
    setSaveError('');
  }

  async function handleSaveQueryConfig(e) {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    try {
      const created = await queryConfigService.create({
        dbConnectionId: Number(id),
        name: saveForm.name,
        description: saveForm.description,
        query: adHocSql,
        suggestedChartType: saveForm.suggestedChartType,
      });
      setQueryConfigs((prev) => [...prev, created]);
      setSaveForm(null);
    } catch (err) {
      setSaveError(err.response?.data?.error || 'Không lưu được query');
    } finally {
      setSaving(false);
    }
  }

  function handleOpenEditForm() {
    const qc = queryConfigs.find((q) => q.id === selectedId);
    if (!qc || !runResult) return;
    setEditForm({
      name: qc.name,
      description: qc.description || '',
      query: runResult.query,
      suggestedChartType: qc.suggestedChartType,
    });
    setEditError('');
  }

  // Sau khi lưu, gọi lại handleSelectQueryConfig để chạy lại query mới nhất
  // thay vì tự ráp runResult — cache server-side đã bị queryConfigService.update()
  // xoá nên lần chạy này chắc chắn lấy đúng kết quả theo SQL vừa sửa.
  async function handleSaveQueryConfigEdit(e) {
    e.preventDefault();
    setEditSaving(true);
    setEditError('');
    try {
      const updated = await queryConfigService.update(selectedId, editForm);
      setQueryConfigs((prev) => prev.map((q) => (q.id === updated.id ? updated : q)));
      setEditForm(null);
      await handleSelectQueryConfig(selectedId);
    } catch (err) {
      setEditError(err.response?.data?.error || 'Không lưu được thay đổi');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDeleteQueryConfig(qcId, e) {
    e.stopPropagation();
    if (!window.confirm('Xoá query này?')) return;
    setDeleteError('');
    try {
      await queryConfigService.remove(qcId);
      setQueryConfigs((prev) => prev.filter((q) => q.id !== qcId));
      if (selectedId === qcId) {
        setSelectedId(null);
        setRunResult(null);
      }
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Không xoá được query');
    }
  }

  return (
    <div className="placeholder-page">
      <header className="placeholder-header">
        <span className="auth-eyebrow">Dashboard Builder</span>
        <nav className="top-nav">
          <Link className="top-nav-link" to="/reports">
            Reports
          </Link>
          <button className="ghost-button" onClick={logout}>
            Đăng xuất ({user?.username})
          </button>
        </nav>
      </header>

      <Link className="back-link" to="/data-sources">
        &larr; Quay lại danh sách
      </Link>

      {loading && <Spinner label="Đang tải..." />}
      {error && <p className="form-message error">{error}</p>}

      {!loading && !error && connection && (
        <div className="detail-card-wrap">
          <div className="detail-card">
            <h1 className="detail-title">{connection.name}</h1>
            <dl className="detail-list">
              <div className="detail-row">
                <dt>Loại DB</dt>
                <dd>{connection.dbType}</dd>
              </div>
              <div className="detail-row">
                <dt>Host</dt>
                <dd>{connection.host}</dd>
              </div>
              <div className="detail-row">
                <dt>Port</dt>
                <dd>{connection.port}</dd>
              </div>
              <div className="detail-row">
                <dt>Database</dt>
                <dd>{connection.databaseName}</dd>
              </div>
              <div className="detail-row">
                <dt>User</dt>
                <dd>{connection.dbUser}</dd>
              </div>
              <div className="detail-row">
                <dt>Tạo lúc</dt>
                <dd>{new Date(connection.createdAt).toLocaleString('vi-VN')}</dd>
              </div>
            </dl>

            <details className="schema-details" onToggle={handleToggleSchema}>
              <summary className="section-title">Schema (ERD)</summary>
              {schemaLoading && <Spinner label="Đang tải schema..." />}
              {schemaError && <p className="form-message error">{schemaError}</p>}
              {schema && schema.tables.length === 0 && (
                <p className="placeholder-text">Không tìm thấy bảng nào</p>
              )}
              {schema && schema.tables.length > 0 && <ErdDiagram schema={schema} />}
            </details>
          </div>
        </div>
      )}

      {!loading && !error && connection && (
        <div className="query-workspace">
          <div className="workspace-panel">
            <h2 className="section-title">Viết SQL của bạn</h2>
            <div className="field">
              <label htmlFor="ad-hoc-sql">Câu lệnh SELECT</label>
              <textarea
                id="ad-hoc-sql"
                rows={4}
                value={adHocSql}
                onChange={(e) => setAdHocSql(e.target.value)}
                placeholder="SELECT * FROM ..."
              />
            </div>
            <button
              className="ghost-button"
              disabled={!adHocSql.trim() || previewLoading}
              onClick={handlePreviewSql}
            >
              {previewLoading ? 'Đang chạy...' : 'Chạy thử'}
            </button>

            <div className="workspace-panel-header">
              <h2 className="section-title">Danh sách query</h2>
              {!queryConfigsLoading && !queryConfigsError && (
                <span className="query-count-badge">{queryConfigs.length}</span>
              )}
            </div>

            {queryConfigsLoading && <Spinner label="Đang tải..." />}
            {queryConfigsError && <p className="form-message error">{queryConfigsError}</p>}

            {!queryConfigsLoading && !queryConfigsError && queryConfigs.length === 0 && (
              <p className="placeholder-text">Chưa có query nào cho kết nối này</p>
            )}

            {!queryConfigsLoading && !queryConfigsError && queryConfigs.length > 0 && (
              <ul className="query-config-list">
                {queryConfigs.map((qc) => (
                  <li
                    className={
                      'query-config-item' +
                      (selectedId === qc.id ? ' query-config-item-selected' : '')
                    }
                    key={qc.id}
                    onClick={() => handleSelectQueryConfig(qc.id)}
                  >
                    <div className="query-config-item-header">
                      <span className="query-config-name">{qc.name}</span>
                      <span className="chart-type-badge">{qc.suggestedChartType}</span>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={(e) => handleDeleteQueryConfig(qc.id, e)}
                      >
                        Xoá
                      </button>
                    </div>
                    {qc.description && (
                      <p className="query-config-description">{qc.description}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {deleteError && <p className="form-message error">{deleteError}</p>}
          </div>

          <div className="workspace-panel">
            {!selectedId && !previewLoading && !previewError && !previewResult && (
              <div className="empty-state">
                <p className="empty-state-title">Chưa có kết quả</p>
                <p className="placeholder-text">Chọn 1 query bên trái hoặc chạy thử SQL của bạn</p>
              </div>
            )}

            {selectedId && (
              <>
                {runLoading && <Spinner label="Đang chạy query..." />}
                {runError && <p className="form-message error">{runError}</p>}

                {!runLoading && !runError && runResult && (
                  <>
                    <div className="query-result-header">
                      <h2 className="section-title">{runResult.name}</h2>
                      <select
                        className="chart-type-select"
                        value={chartType}
                        onChange={(e) => setChartType(e.target.value)}
                      >
                        {getApplicableChartTypes(runResult).map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      {!editForm && (
                        <button type="button" className="ghost-button" onClick={handleOpenEditForm}>
                          Sửa
                        </button>
                      )}
                    </div>

                    {!editForm && (
                      <pre className="query-sql-block">
                        <code>{runResult.query}</code>
                      </pre>
                    )}

                    {editForm && (
                      <form onSubmit={handleSaveQueryConfigEdit}>
                        <div className="field">
                          <label htmlFor="edit-query-name">Tên query</label>
                          <input
                            id="edit-query-name"
                            type="text"
                            required
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="edit-query-description">Mô tả</label>
                          <input
                            id="edit-query-description"
                            type="text"
                            value={editForm.description}
                            onChange={(e) =>
                              setEditForm({ ...editForm, description: e.target.value })
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="edit-query-sql">Câu lệnh SELECT</label>
                          <textarea
                            id="edit-query-sql"
                            rows={4}
                            required
                            value={editForm.query}
                            onChange={(e) => setEditForm({ ...editForm, query: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="edit-query-chart-type">Loại chart gợi ý</label>
                          <select
                            id="edit-query-chart-type"
                            className="chart-type-select"
                            value={editForm.suggestedChartType}
                            onChange={(e) =>
                              setEditForm({ ...editForm, suggestedChartType: e.target.value })
                            }
                          >
                            {getApplicableChartTypes(runResult).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {editError && <p className="form-message error">{editError}</p>}
                        <button className="primary-button" type="submit" disabled={editSaving}>
                          {editSaving ? 'Đang lưu...' : 'Lưu thay đổi'}
                        </button>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() => setEditForm(null)}
                        >
                          Huỷ
                        </button>
                      </form>
                    )}

                    {!editForm &&
                      (runResult.rows.length === 0 ? (
                        <p className="placeholder-text">Không có dữ liệu</p>
                      ) : (
                        <ChartRenderer runResult={runResult} chartType={chartType} />
                      ))}
                  </>
                )}
              </>
            )}

            {!selectedId && (previewLoading || previewError || previewResult) && (
              <>
                {previewLoading && <Spinner label="Đang chạy SQL..." />}
                {previewError && <p className="form-message error">{previewError}</p>}

                {!previewLoading && !previewError && previewResult && (
                  <>
                    <div className="query-result-header">
                      <h2 className="section-title">Kết quả SQL</h2>
                      <select
                        className="chart-type-select"
                        value={previewChartType}
                        onChange={(e) => setPreviewChartType(e.target.value)}
                      >
                        {getApplicableChartTypes(previewResult).map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {previewResult.rows.length === 0 ? (
                      <p className="placeholder-text">Không có dữ liệu</p>
                    ) : (
                      <ChartRenderer runResult={previewResult} chartType={previewChartType} />
                    )}

                    {!saveForm && (
                      <button className="ghost-button" onClick={handleOpenSaveForm}>
                        Lưu thành query
                      </button>
                    )}

                    {saveForm && (
                      <form onSubmit={handleSaveQueryConfig}>
                        <div className="field">
                          <label htmlFor="save-query-name">Tên query</label>
                          <input
                            id="save-query-name"
                            type="text"
                            required
                            value={saveForm.name}
                            onChange={(e) => setSaveForm({ ...saveForm, name: e.target.value })}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="save-query-description">Mô tả</label>
                          <input
                            id="save-query-description"
                            type="text"
                            value={saveForm.description}
                            onChange={(e) =>
                              setSaveForm({ ...saveForm, description: e.target.value })
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="save-query-chart-type">Loại chart gợi ý</label>
                          <select
                            id="save-query-chart-type"
                            className="chart-type-select"
                            value={saveForm.suggestedChartType}
                            onChange={(e) =>
                              setSaveForm({ ...saveForm, suggestedChartType: e.target.value })
                            }
                          >
                            {getApplicableChartTypes(previewResult).map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        {saveError && <p className="form-message error">{saveError}</p>}
                        <button className="primary-button" type="submit" disabled={saving}>
                          {saving ? 'Đang lưu...' : 'Lưu'}
                        </button>
                      </form>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
