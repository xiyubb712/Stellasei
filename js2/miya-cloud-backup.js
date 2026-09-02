/**
 * Stellasei 星绥 - 云端备份与恢复模块
 * 基于 Supabase 实现全量备份、自动备份、选择恢复
 */
(function (global) {
  'use strict';

  // ==================== 配置 ====================
  var SUPABASE_URL = 'https://ukccgjjqrgtnnbacokde.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_d_mKJDF8vZTWM_NaMT2vIg_2aDw2Zn0';
  var STORAGE_BUCKET = 'Stellasei';
  var AUTO_BACKUP_KEY = 'stellasei_auto_backup_enabled';
  var AUTO_BACKUP_FREQ_KEY = 'stellasei_auto_backup_freq';
  var LAST_BACKUP_KEY = 'stellasei_last_backup_time';

  // ==================== 状态 ====================
  var supabaseClient = null;
  var isBackingUp = false;
  var isRestoring = false;

  // ==================== 初始化 Supabase 客户端 ====================
  function initSupabase() {
    if (supabaseClient) return supabaseClient;
    try {
      // 检查是否已经加载了 supabase SDK
      if (typeof global.supabase === 'undefined') {
        console.error('[CloudBackup] Supabase SDK 未加载');
        return null;
      }
      supabaseClient = global.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('[CloudBackup] Supabase 客户端初始化成功');
      return supabaseClient;
    } catch (e) {
      console.error('[CloudBackup] Supabase 初始化失败:', e);
      return null;
    }
  }

  // ==================== 数据导出 ====================

  /**
   * 导出所有 localStorage 数据
   */
  function exportLocalStorage() {
    var data = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key) {
          data[key] = localStorage.getItem(key);
        }
      }
    } catch (e) {
      console.error('[CloudBackup] 导出 localStorage 失败:', e);
    }
    return data;
  }

  /**
   * 导出指定 IndexedDB 数据库的所有数据（修复版）
   */
  function exportIndexedDB(dbName) {
    return new Promise(function (resolve, reject) {
      console.log('[CloudBackup] 开始导出 IndexedDB: ' + dbName);
      var result = {}; // 把 result 提到外面，避免超时处理时访问不到
      try {
        var req = indexedDB.open(dbName);

        req.onupgradeneeded = function () {
          console.log('[CloudBackup] 数据库 ' + dbName + ' 不存在或需要升级，跳过');
          var db = req.result;
          db.close();
          resolve({});
        };

        req.onsuccess = function () {
          var db = req.result;
          var stores = Array.from(db.objectStoreNames);
          console.log('[CloudBackup] ' + dbName + ' 有 ' + stores.length + ' 个对象存储: ' + stores.join(', '));

          if (stores.length === 0) {
            db.close();
            resolve({});
            return;
          }

          var storePromises = stores.map(function (storeName) {
            return new Promise(function (storeResolve, storeReject) {
              try {
                var tx = db.transaction(storeName, 'readonly');
                var store = tx.objectStore(storeName);

                // 用 Promise 包装 getAll 和 getAllKeys
                var getAllPromise = new Promise(function (res, rej) {
                  var r = store.getAll();
                  r.onsuccess = function () { res(r.result); };
                  r.onerror = function () { rej(r.error); };
                });

                var getKeysPromise = new Promise(function (res, rej) {
                  var r = store.getAllKeys();
                  r.onsuccess = function () { res(r.result); };
                  r.onerror = function () { rej(r.error); };
                });

                Promise.all([getAllPromise, getKeysPromise]).then(function (results) {
                  var values = results[0];
                  var keys = results[1];
                  console.log('[CloudBackup] ' + dbName + '.' + storeName + ' 有 ' + keys.length + ' 条数据');

                  var storeData = {};
                  var blobPromises = [];
                  var blobCount = 0;

                  for (var i = 0; i < keys.length; i++) {
                    (function (k, v) {
                      // 检测 blob 数据：可能是直接的 Blob 对象，也可能是包含 blob 字段的对象
                      var directBlob = v && (v instanceof Blob || v instanceof File ||
                        (Object.prototype.toString.call(v) === '[object Blob]') ||
                        (Object.prototype.toString.call(v) === '[object File]'));
                      var objectWithBlob = v && typeof v === 'object' && v.blob && (v.blob instanceof Blob || v.blob instanceof File ||
                        (Object.prototype.toString.call(v.blob) === '[object Blob]') ||
                        (Object.prototype.toString.call(v.blob) === '[object File]'));

                      if (directBlob) {
                        blobCount++;
                        console.log('[CloudBackup] 发现直接 blob 数据: ' + k + ', 大小: ' + v.size + ' bytes, 类型: ' + v.type);
                        var blobPromise = new Promise(function (blobResolve) {
                          var reader = new FileReader();
                          reader.onload = function () {
                            storeData[k] = { __blob: true, data: reader.result, type: v.type, size: v.size };
                            blobResolve();
                          };
                          reader.onerror = function () {
                            console.warn('[CloudBackup] blob 转换失败: ' + k);
                            storeData[k] = { __blob: true, data: '', type: v.type, size: v.size };
                            blobResolve();
                          };
                          reader.readAsDataURL(v);
                        });
                        blobPromises.push(blobPromise);
                      } else if (objectWithBlob) {
                        blobCount++;
                        var innerBlob = v.blob;
                        console.log('[CloudBackup] 发现对象内 blob 数据: ' + k + ', 大小: ' + innerBlob.size + ' bytes, 类型: ' + innerBlob.type);
                        var objBlobPromise = new Promise(function (blobResolve) {
                          var reader = new FileReader();
                          reader.onload = function () {
                            // 复制对象，把 blob 替换成 base64
                            var objCopy = Object.assign({}, v);
                            delete objCopy.blob;
                            objCopy.__blobInObject = true;
                            objCopy.__blobData = reader.result;
                            objCopy.__blobType = innerBlob.type;
                            objCopy.__blobSize = innerBlob.size;
                            storeData[k] = objCopy;
                            blobResolve();
                          };
                          reader.onerror = function () {
                            console.warn('[CloudBackup] 对象内 blob 转换失败: ' + k);
                            var objCopy = Object.assign({}, v);
                            delete objCopy.blob;
                            objCopy.__blobInObject = true;
                            objCopy.__blobData = '';
                            objCopy.__blobType = innerBlob.type;
                            objCopy.__blobSize = innerBlob.size;
                            storeData[k] = objCopy;
                            blobResolve();
                          };
                          reader.readAsDataURL(innerBlob);
                        });
                        blobPromises.push(objBlobPromise);
                      } else {
                        storeData[k] = v;
                      }
                    })(keys[i], values[i]);
                  }

                  console.log('[CloudBackup] ' + dbName + '.' + storeName + ' 中有 ' + blobCount + ' 个 blob 数据');

                  // 等待所有 blob 转换完成
                  Promise.all(blobPromises).then(function () {
                    result[storeName] = storeData;
                    console.log('[CloudBackup] ' + dbName + '.' + storeName + ' 导出完成');
                    storeResolve();
                  }).catch(function (err) {
                    console.warn('[CloudBackup] ' + dbName + '.' + storeName + ' blob 转换出错:', err);
                    result[storeName] = storeData;
                    storeResolve();
                  });

                }).catch(function (err) {
                  console.warn('[CloudBackup] ' + dbName + '.' + storeName + ' 读取失败:', err);
                  storeResolve(); // 即使失败也继续，不阻塞整个备份
                });

                tx.onerror = function () {
                  console.warn('[CloudBackup] ' + dbName + '.' + storeName + ' 事务错误:', tx.error);
                  storeResolve();
                };

              } catch (e) {
                console.warn('[CloudBackup] ' + dbName + '.' + storeName + ' 异常:', e);
                storeResolve();
              }
            });
          });

          Promise.all(storePromises).then(function () {
            db.close();
            console.log('[CloudBackup] IndexedDB ' + dbName + ' 全部导出完成');
            resolve(result);
          }).catch(function (err) {
            db.close();
            console.warn('[CloudBackup] IndexedDB ' + dbName + ' 导出部分失败:', err);
            resolve(result); // 即使部分失败也返回已导出的数据
          });

        };

        req.onerror = function () {
          console.warn('[CloudBackup] 打开 IndexedDB ' + dbName + ' 失败:', req.error);
          resolve({}); // 失败也返回空对象，不阻塞备份
        };

        // 超时处理：60秒后强制完成（给 blob 转换更多时间）
        setTimeout(function () {
          console.warn('[CloudBackup] IndexedDB ' + dbName + ' 导出超时，强制完成');
          try { req.result && req.result.close(); } catch (e) {}
          resolve(result || {});
        }, 60000);

      } catch (e) {
        console.warn('[CloudBackup] 导出 IndexedDB ' + dbName + ' 异常:', e);
        resolve({});
      }
    });
  }

  /**
   * 导出所有数据（全量备份）
   */
  async function exportAllData() {
    console.log('[CloudBackup] 开始导出所有数据...');

    var backupData = {
      version: '1.0',
      backupTime: new Date().toISOString(),
      userAgent: navigator.userAgent,
      localStorage: {},
      indexedDB: {}
    };

    // 1. 导出 localStorage
    backupData.localStorage = exportLocalStorage();
    console.log('[CloudBackup] localStorage 导出完成，共 ' + Object.keys(backupData.localStorage).length + ' 项');

    // 2. 导出 miya-kv-store
    try {
      backupData.indexedDB['miya-kv-store'] = await exportIndexedDB('miya-kv-store');
      console.log('[CloudBackup] miya-kv-store 导出完成');
    } catch (e) {
      console.warn('[CloudBackup] miya-kv-store 导出失败:', e);
      backupData.indexedDB['miya-kv-store'] = {};
    }

    // 3. 导出 miya-theme-media
    try {
      backupData.indexedDB['miya-theme-media'] = await exportIndexedDB('miya-theme-media');
      console.log('[CloudBackup] miya-theme-media 导出完成');
    } catch (e) {
      console.warn('[CloudBackup] miya-theme-media 导出失败:', e);
      backupData.indexedDB['miya-theme-media'] = {};
    }

    console.log('[CloudBackup] 所有数据导出完成');
    return backupData;
  }

  // ==================== 数据导入 ====================

  /**
   * 导入 localStorage 数据
   */
  function importLocalStorage(data) {
    try {
      // 先清空现有数据
      localStorage.clear();
      // 导入备份数据
      for (var key in data) {
        if (data.hasOwnProperty(key)) {
          localStorage.setItem(key, data[key]);
        }
      }
      console.log('[CloudBackup] localStorage 导入完成，共 ' + Object.keys(data).length + ' 项');
    } catch (e) {
      console.error('[CloudBackup] localStorage 导入失败:', e);
    }
  }

  /**
   * 导入 IndexedDB 数据
   */
  function importIndexedDB(dbName, data) {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(dbName);
        req.onsuccess = function () {
          var db = req.result;
          var stores = Object.keys(data);
          if (stores.length === 0) {
            db.close();
            resolve();
            return;
          }

          var tx = db.transaction(stores, 'readwrite');
          var completed = 0;

          stores.forEach(function (storeName) {
            var store = tx.objectStore(storeName);
            var storeData = data[storeName];
            var keys = Object.keys(storeData);

            // 先清空现有数据
            store.clear();

            var putCount = 0;
            if (keys.length === 0) {
              completed++;
              if (completed === stores.length) {
                db.close();
                resolve();
              }
              return;
            }

            keys.forEach(function (key) {
              var value = storeData[key];
              // 处理直接的 blob 数据
              if (value && value.__blob) {
                // base64 转 blob
                var byteString = atob(value.data.split(',')[1]);
                var mimeString = value.type;
                var ab = new ArrayBuffer(byteString.length);
                var ia = new Uint8Array(ab);
                for (var i = 0; i < byteString.length; i++) {
                  ia[i] = byteString.charCodeAt(i);
                }
                var blob = new Blob([ab], { type: mimeString });
                var putReq = store.put(blob, key);
              } else if (value && value.__blobInObject) {
                // 处理包含 blob 的对象：把 base64 转回 blob，放回对象的 blob 字段
                var byteString2 = atob(value.__blobData.split(',')[1]);
                var mimeString2 = value.__blobType;
                var ab2 = new ArrayBuffer(byteString2.length);
                var ia2 = new Uint8Array(ab2);
                for (var j = 0; j < byteString2.length; j++) {
                  ia2[j] = byteString2.charCodeAt(j);
                }
                var blob2 = new Blob([ab2], { type: mimeString2 });
                // 复制对象，删除临时字段，添加 blob 字段
                var objCopy = Object.assign({}, value);
                delete objCopy.__blobInObject;
                delete objCopy.__blobData;
                delete objCopy.__blobType;
                delete objCopy.__blobSize;
                objCopy.blob = blob2;
                var putReq = store.put(objCopy, key);
              } else {
                var putReq = store.put(value, key);
              }
              putReq.onsuccess = function () {
                putCount++;
                if (putCount === keys.length) {
                  completed++;
                  if (completed === stores.length) {
                    db.close();
                    resolve();
                  }
                }
              };
              putReq.onerror = function () {
                putCount++;
                if (putCount === keys.length) {
                  completed++;
                  if (completed === stores.length) {
                    db.close();
                    resolve();
                  }
                }
              };
            });
          });

          tx.onerror = function () {
            db.close();
            reject(tx.error);
          };
        };
        req.onerror = function () {
          reject(req.error);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  /**
   * 导入所有数据（全量恢复）
   */
  async function importAllData(backupData) {
    console.log('[CloudBackup] 开始导入所有数据...');

    if (!backupData || !backupData.version) {
      throw new Error('无效的备份数据');
    }

    // 1. 导入 localStorage
    if (backupData.localStorage) {
      importLocalStorage(backupData.localStorage);
    }

    // 2. 导入 miya-kv-store
    if (backupData.indexedDB && backupData.indexedDB['miya-kv-store']) {
      try {
        await importIndexedDB('miya-kv-store', backupData.indexedDB['miya-kv-store']);
        console.log('[CloudBackup] miya-kv-store 导入完成');
      } catch (e) {
        console.error('[CloudBackup] miya-kv-store 导入失败:', e);
      }
    }

    // 3. 导入 miya-theme-media
    if (backupData.indexedDB && backupData.indexedDB['miya-theme-media']) {
      try {
        await importIndexedDB('miya-theme-media', backupData.indexedDB['miya-theme-media']);
        console.log('[CloudBackup] miya-theme-media 导入完成');
      } catch (e) {
        console.error('[CloudBackup] miya-theme-media 导入失败:', e);
      }
    }

    console.log('[CloudBackup] 所有数据导入完成');
  }

  // ==================== 上传到 Supabase ====================

  /**
   * 上传备份到 Supabase Storage
   */
  async function uploadBackup(backupData, backupName) {
    var client = initSupabase();
    if (!client) throw new Error('Supabase 客户端未初始化');

    // 生成文件名（把中文备份名称转成英文，避免Supabase报错）
    var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    var safeBackupName = (backupName || 'manual')
      .replace(/手动备份/g, 'manual')
      .replace(/自动备份/g, 'auto')
      .replace(/[^\w\-]/g, '_'); // 把其他非英文数字字符替换成下划线
    var fileName = 'backups/' + timestamp + '_' + safeBackupName + '.json';

    // 转成 JSON 字符串
    var jsonStr = JSON.stringify(backupData);
    var blob = new Blob([jsonStr], { type: 'application/json' });

    console.log('[CloudBackup] 开始上传备份: ' + fileName + ' (' + (blob.size / 1024 / 1024).toFixed(2) + ' MB)');

    // 上传到 Storage
    var { data, error } = await client.storage
      .from(STORAGE_BUCKET)
      .upload(fileName, blob, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('[CloudBackup] 上传失败:', error);
      throw error;
    }

    console.log('[CloudBackup] 上传成功:', data);

    // 记录最后备份时间
    try {
      localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
    } catch (e) {}

    return { fileName: fileName, size: blob.size };
  }

  /**
   * 从 Supabase 下载备份
   */
  async function downloadBackup(fileName) {
    var client = initSupabase();
    if (!client) throw new Error('Supabase 客户端未初始化');

    // 确保文件名包含完整路径（backups/ 前缀）
    var fullPath = fileName;
    if (fullPath.indexOf('backups/') !== 0) {
      fullPath = 'backups/' + fileName;
    }

    console.log('[CloudBackup] 开始下载备份: ' + fullPath);

    var { data, error } = await client.storage
      .from(STORAGE_BUCKET)
      .download(fullPath);

    if (error) {
      console.error('[CloudBackup] 下载失败:', error);
      throw error;
    }

    // 读取 JSON
    var text = await data.text();
    var backupData = JSON.parse(text);

    console.log('[CloudBackup] 下载成功，备份时间: ' + backupData.backupTime);
    return backupData;
  }

  /**
   * 获取备份列表
   */
  async function getBackupList() {
    var client = initSupabase();
    if (!client) throw new Error('Supabase 客户端未初始化');

    // 从 Storage 列出文件
    var { data, error } = await client.storage
      .from(STORAGE_BUCKET)
      .list('backups', {
        limit: 100,
        offset: 0,
        sortBy: { column: 'name', order: 'desc' }
      });

    if (error) {
      console.error('[CloudBackup] 获取备份列表失败:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * 删除备份
   */
  async function deleteBackup(fileName) {
    var client = initSupabase();
    if (!client) throw new Error('Supabase 客户端未初始化');

    // 确保文件名包含完整路径（backups/ 前缀）
    var fullPath = fileName;
    if (fullPath.indexOf('backups/') !== 0) {
      fullPath = 'backups/' + fileName;
    }

    console.log('[CloudBackup] 准备删除备份: ' + fullPath);

    var { data, error } = await client.storage
      .from(STORAGE_BUCKET)
      .remove([fullPath]);

    if (error) {
      console.error('[CloudBackup] 删除备份失败:', error);
      throw error;
    }

    console.log('[CloudBackup] 删除备份成功:', fullPath);
    return data;
  }

  // ==================== 备份与恢复入口 ====================

  /**
   * 清理旧备份（自动备份保留4份，手动备份保留3份）
   */
  async function cleanupOldBackups() {
    try {
      console.log('[CloudBackup] 开始清理旧备份...');
      var list = await getBackupList();
      if (!list || list.length === 0) {
        console.log('[CloudBackup] 没有备份需要清理');
        return;
      }

      // 按备份类型分组
      var autoBackups = [];
      var manualBackups = [];

      list.forEach(function (item) {
        var name = item.name || '';
        if (name.indexOf('_auto') >= 0) {
          autoBackups.push(item);
        } else if (name.indexOf('_manual') >= 0) {
          manualBackups.push(item);
        }
      });

      // 按时间排序（从新到旧）
      autoBackups.sort(function (a, b) {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });
      manualBackups.sort(function (a, b) {
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      });

      console.log('[CloudBackup] 自动备份数量: ' + autoBackups.length + ' (保留4份)');
      console.log('[CloudBackup] 手动备份数量: ' + manualBackups.length + ' (保留3份)');

      // 删除超过保留数量的旧自动备份
      var AUTO_KEEP = 4;
      if (autoBackups.length > AUTO_KEEP) {
        var toDeleteAuto = autoBackups.slice(AUTO_KEEP);
        for (var i = 0; i < toDeleteAuto.length; i++) {
          console.log('[CloudBackup] 删除旧的自动备份: ' + toDeleteAuto[i].name);
          try {
            await deleteBackup(toDeleteAuto[i].name);
          } catch (e) {
            console.warn('[CloudBackup] 删除自动备份失败: ' + toDeleteAuto[i].name, e);
          }
        }
      }

      // 删除超过保留数量的旧手动备份
      var MANUAL_KEEP = 3;
      if (manualBackups.length > MANUAL_KEEP) {
        var toDeleteManual = manualBackups.slice(MANUAL_KEEP);
        for (var j = 0; j < toDeleteManual.length; j++) {
          console.log('[CloudBackup] 删除旧的手动备份: ' + toDeleteManual[j].name);
          try {
            await deleteBackup(toDeleteManual[j].name);
          } catch (e) {
            console.warn('[CloudBackup] 删除手动备份失败: ' + toDeleteManual[j].name, e);
          }
        }
      }

      console.log('[CloudBackup] 旧备份清理完成');
    } catch (e) {
      console.warn('[CloudBackup] 清理旧备份出错:', e);
    }
  }

  /**
   * 执行备份
   */
  async function doBackup(backupName) {
    if (isBackingUp) {
      throw new Error('正在备份中，请稍候...');
    }
    isBackingUp = true;
    try {
      console.log('[CloudBackup] ========== 开始备份 ==========');
      var startTime = Date.now();

      // 1. 导出所有数据
      var backupData = await exportAllData();

      // 2. 上传到 Supabase
      var result = await uploadBackup(backupData, backupName);

      var duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('[CloudBackup] ========== 备份完成，耗时 ' + duration + ' 秒 ==========');

      // 3. 清理旧备份（自动备份保留4份，手动备份保留3份）
      console.log('[CloudBackup] 备份成功，开始清理旧备份...');
      await cleanupOldBackups();

      return result;
    } finally {
      isBackingUp = false;
    }
  }

  /**
   * 执行恢复
   */
  async function doRestore(fileName) {
    if (isRestoring) {
      throw new Error('正在恢复中，请稍候...');
    }
    isRestoring = true;
    try {
      console.log('[CloudBackup] ========== 开始恢复 ==========');
      var startTime = Date.now();

      // 1. 下载备份
      var backupData = await downloadBackup(fileName);

      // 2. 导入所有数据
      await importAllData(backupData);

      var duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log('[CloudBackup] ========== 恢复完成，耗时 ' + duration + ' 秒 ==========');

      return backupData;
    } finally {
      isRestoring = false;
    }
  }

  // ==================== 自动备份 ====================

  /**
   * 检查是否需要自动备份
   */
  function checkAutoBackup() {
    try {
      var enabled = localStorage.getItem(AUTO_BACKUP_KEY) === 'true';
      if (!enabled) return;

      var freq = localStorage.getItem(AUTO_BACKUP_FREQ_KEY) || 'daily'; // daily, twice_daily
      var lastBackup = localStorage.getItem(LAST_BACKUP_KEY);

      var now = new Date();
      var shouldBackup = false;

      if (!lastBackup) {
        shouldBackup = true;
      } else {
        var last = new Date(lastBackup);
        var hoursDiff = (now - last) / (1000 * 60 * 60);

        if (freq === 'daily' && hoursDiff >= 24) {
          shouldBackup = true;
        } else if (freq === 'twice_daily' && hoursDiff >= 12) {
          shouldBackup = true;
        }
      }

      if (shouldBackup && !isBackingUp) {
        console.log('[CloudBackup] 触发自动备份');
        doBackup('自动备份').catch(function (e) {
          console.error('[CloudBackup] 自动备份失败:', e);
        });
      }
    } catch (e) {
      console.error('[CloudBackup] 检查自动备份失败:', e);
    }
  }

  /**
   * 设置自动备份
   */
  function setAutoBackup(enabled, freq) {
    try {
      localStorage.setItem(AUTO_BACKUP_KEY, enabled ? 'true' : 'false');
      if (freq) {
        localStorage.setItem(AUTO_BACKUP_FREQ_KEY, freq);
      }
      console.log('[CloudBackup] 自动备份设置: enabled=' + enabled + ', freq=' + (freq || '未更改'));
    } catch (e) {
      console.error('[CloudBackup] 设置自动备份失败:', e);
    }
  }

  /**
   * 获取自动备份设置
   */
  function getAutoBackupSettings() {
    return {
      enabled: localStorage.getItem(AUTO_BACKUP_KEY) === 'true',
      freq: localStorage.getItem(AUTO_BACKUP_FREQ_KEY) || 'daily',
      lastBackup: localStorage.getItem(LAST_BACKUP_KEY) || null
    };
  }

  // ==================== UI 界面 ====================

  /**
   * 注入 CSS 样式
   */
  function injectStyles() {
    if (document.getElementById('stellasei-backup-styles')) return;
    var style = document.createElement('style');
    style.id = 'stellasei-backup-styles';
    style.textContent = `
      .stellasei-backup-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .stellasei-backup-panel {
        background: #fff;
        border-radius: 16px;
        width: 90%;
        max-width: 420px;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      }
      .stellasei-backup-header {
        padding: 20px 24px 16px;
        border-bottom: 1px solid #f0f0f0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .stellasei-backup-title {
        font-size: 18px;
        font-weight: 600;
        color: #1a1a1a;
        margin: 0;
      }
      .stellasei-backup-close {
        background: none;
        border: none;
        font-size: 24px;
        color: #999;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
      }
      .stellasei-backup-close:hover { color: #333; }
      .stellasei-backup-body { padding: 20px 24px; }
      .stellasei-backup-section { margin-bottom: 24px; }
      .stellasei-backup-section-title {
        font-size: 14px;
        font-weight: 600;
        color: #666;
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .stellasei-backup-btn {
        width: 100%;
        padding: 14px 20px;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }
      .stellasei-backup-btn--primary {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #fff;
      }
      .stellasei-backup-btn--primary:hover { opacity: 0.9; transform: translateY(-1px); }
      .stellasei-backup-btn--primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
      .stellasei-backup-btn--danger {
        background: #fff0f0;
        color: #e74c3c;
      }
      .stellasei-backup-btn--danger:hover { background: #ffe0e0; }
      .stellasei-backup-btn--ghost {
        background: #f5f5f5;
        color: #666;
      }
      .stellasei-backup-btn--ghost:hover { background: #eee; }
      .stellasei-backup-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 0;
        border-bottom: 1px solid #f5f5f5;
      }
      .stellasei-backup-row:last-child { border-bottom: none; }
      .stellasei-backup-row-label {
        font-size: 14px;
        color: #333;
      }
      .stellasei-backup-row-desc {
        font-size: 12px;
        color: #999;
        margin-top: 2px;
      }
      .stellasei-backup-toggle {
        position: relative;
        width: 44px;
        height: 24px;
        background: #ddd;
        border-radius: 12px;
        cursor: pointer;
        transition: background 0.3s;
      }
      .stellasei-backup-toggle.active { background: #667eea; }
      .stellasei-backup-toggle::after {
        content: '';
        position: absolute;
        top: 2px; left: 2px;
        width: 20px; height: 20px;
        background: #fff;
        border-radius: 50%;
        transition: transform 0.3s;
      }
      .stellasei-backup-toggle.active::after { transform: translateX(20px); }
      .stellasei-backup-select {
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 8px;
        font-size: 13px;
        color: #333;
        background: #fff;
        cursor: pointer;
      }
      .stellasei-backup-list {
        max-height: 240px;
        overflow-y: auto;
      }
      .stellasei-backup-item {
        padding: 14px;
        border: 1px solid #eee;
        border-radius: 10px;
        margin-bottom: 10px;
      }
      .stellasei-backup-item-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .stellasei-backup-item-name {
        font-size: 14px;
        font-weight: 600;
        color: #333;
      }
      .stellasei-backup-item-time {
        font-size: 12px;
        color: #999;
      }
      .stellasei-backup-item-size {
        font-size: 12px;
        color: #666;
        margin-bottom: 10px;
      }
      .stellasei-backup-item-actions {
        display: flex;
        gap: 8px;
      }
      .stellasei-backup-item-btn {
        flex: 1;
        padding: 8px 12px;
        border: none;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
      }
      .stellasei-backup-item-btn--restore {
        background: #eef2ff;
        color: #667eea;
      }
      .stellasei-backup-item-btn--restore:hover { background: #e0e7ff; }
      .stellasei-backup-item-btn--delete {
        background: #fff0f0;
        color: #e74c3c;
      }
      .stellasei-backup-item-btn--delete:hover { background: #ffe0e0; }
      .stellasei-backup-status {
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 13px;
        margin-bottom: 16px;
        display: none;
      }
      .stellasei-backup-status--info {
        background: #eef2ff;
        color: #667eea;
        display: block;
      }
      .stellasei-backup-status--success {
        background: #ecfdf5;
        color: #10b981;
        display: block;
      }
      .stellasei-backup-status--error {
        background: #fef2f2;
        color: #ef4444;
        display: block;
      }
      .stellasei-backup-empty {
        text-align: center;
        padding: 40px 20px;
        color: #999;
        font-size: 14px;
      }
      .stellasei-backup-loading {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 2px solid rgba(255,255,255,0.3);
        border-top-color: #fff;
        border-radius: 50%;
        animation: stellasei-spin 0.8s linear infinite;
      }
      @keyframes stellasei-spin {
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  /**
   * 格式化文件大小
   */
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  /**
   * 格式化时间
   */
  function formatTime(isoString) {
    try {
      var d = new Date(isoString);
      return d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0') + ' ' +
        String(d.getHours()).padStart(2, '0') + ':' +
        String(d.getMinutes()).padStart(2, '0');
    } catch (e) {
      return isoString;
    }
  }

  /**
   * 显示状态消息
   */
  function showStatus(panel, message, type) {
    var statusEl = panel.querySelector('.stellasei-backup-status');
    statusEl.textContent = message;
    statusEl.className = 'stellasei-backup-status stellasei-backup-status--' + type;
  }

  /**
   * 刷新备份列表
   */
  async function refreshBackupList(panel) {
    var listEl = panel.querySelector('.stellasei-backup-list');
    listEl.innerHTML = '<div class="stellasei-backup-empty">加载中...</div>';

    try {
      var list = await getBackupList();
      if (!list || list.length === 0) {
        listEl.innerHTML = '<div class="stellasei-backup-empty">暂无备份记录<br><small>点击上方按钮立即备份</small></div>';
        return;
      }

      listEl.innerHTML = '';
      list.forEach(function (item) {
        var itemEl = document.createElement('div');
        itemEl.className = 'stellasei-backup-item';

        var name = item.name || '未命名备份';
        var isAuto = name.indexOf('自动') !== -1;
        var displayName = isAuto ? '🤖 ' + name : '📦 ' + name;

        itemEl.innerHTML = `
          <div class="stellasei-backup-item-header">
            <div class="stellasei-backup-item-name">${displayName}</div>
          </div>
          <div class="stellasei-backup-item-time">${formatTime(item.created_at || new Date().toISOString())}</div>
          <div class="stellasei-backup-item-size">大小: ${formatSize(item.metadata && item.metadata.size ? item.metadata.size : 0)}</div>
          <div class="stellasei-backup-item-actions">
            <button class="stellasei-backup-item-btn stellasei-backup-item-btn--restore" data-file="backups/${item.name}">恢复此备份</button>
            <button class="stellasei-backup-item-btn stellasei-backup-item-btn--delete" data-file="backups/${item.name}">删除</button>
          </div>
        `;

        // 恢复按钮
        itemEl.querySelector('.stellasei-backup-item-btn--restore').addEventListener('click', async function (e) {
          var fileName = e.target.getAttribute('data-file');
          if (!confirm('确定要恢复此备份吗？\n\n恢复后当前所有数据将被覆盖，建议先备份当前数据。')) {
            return;
          }
          try {
            showStatus(panel, '正在恢复备份，请稍候...', 'info');
            await doRestore(fileName);
            showStatus(panel, '恢复成功！页面将在3秒后刷新...', 'success');
            setTimeout(function () { location.reload(); }, 3000);
          } catch (err) {
            showStatus(panel, '恢复失败: ' + err.message, 'error');
          }
        });

        // 删除按钮
        itemEl.querySelector('.stellasei-backup-item-btn--delete').addEventListener('click', async function (e) {
          var fileName = e.target.getAttribute('data-file');
          if (!confirm('确定要删除此备份吗？此操作不可恢复。')) {
            return;
          }
          try {
            await deleteBackup(fileName);
            showStatus(panel, '备份已删除', 'success');
            refreshBackupList(panel);
          } catch (err) {
            showStatus(panel, '删除失败: ' + err.message, 'error');
          }
        });

        listEl.appendChild(itemEl);
      });
    } catch (err) {
      listEl.innerHTML = '<div class="stellasei-backup-empty">加载失败<br><small>' + err.message + '</small></div>';
    }
  }

  /**
   * 显示备份面板
   */
  function showBackupPanel() {
    injectStyles();

    // 如果已经存在，先移除
    var old = document.querySelector('.stellasei-backup-overlay');
    if (old) old.remove();

    var settings = getAutoBackupSettings();

    var overlay = document.createElement('div');
    overlay.className = 'stellasei-backup-overlay';
    overlay.innerHTML = `
      <div class="stellasei-backup-panel">
        <div class="stellasei-backup-header">
          <h3 class="stellasei-backup-title">☁️ 云端备份</h3>
          <button class="stellasei-backup-close" aria-label="关闭">×</button>
        </div>
        <div class="stellasei-backup-body">
          <div class="stellasei-backup-status"></div>

          <div class="stellasei-backup-section">
            <div class="stellasei-backup-section-title">立即备份</div>
            <button class="stellasei-backup-btn stellasei-backup-btn--primary" id="stellasei-backup-now">
              <span>📦 立即备份所有数据</span>
            </button>
          </div>

          <div class="stellasei-backup-section">
            <div class="stellasei-backup-section-title">自动备份</div>
            <div class="stellasei-backup-row">
              <div>
                <div class="stellasei-backup-row-label">开启自动备份</div>
                <div class="stellasei-backup-row-desc">开启后按设定频率自动备份</div>
              </div>
              <div class="stellasei-backup-toggle ${settings.enabled ? 'active' : ''}" id="stellasei-auto-toggle"></div>
            </div>
            <div class="stellasei-backup-row" id="stellasei-freq-row" style="${settings.enabled ? '' : 'display:none;opacity:0.5;'}">
              <div>
                <div class="stellasei-backup-row-label">备份频率</div>
                <div class="stellasei-backup-row-desc">上次备份: ${settings.lastBackup ? formatTime(settings.lastBackup) : '从未备份'}</div>
              </div>
              <select class="stellasei-backup-select" id="stellasei-freq-select">
                <option value="daily" ${settings.freq === 'daily' ? 'selected' : ''}>每天一次</option>
                <option value="twice_daily" ${settings.freq === 'twice_daily' ? 'selected' : ''}>每天两次</option>
              </select>
            </div>
          </div>

          <div class="stellasei-backup-section">
            <div class="stellasei-backup-section-title">备份记录</div>
            <div class="stellasei-backup-list"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    var panel = overlay.querySelector('.stellasei-backup-panel');

    // 关闭按钮
    overlay.querySelector('.stellasei-backup-close').addEventListener('click', function () {
      overlay.remove();
    });

    // 点击遮罩关闭
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });

    // 立即备份按钮
    var backupBtn = overlay.querySelector('#stellasei-backup-now');
    backupBtn.addEventListener('click', async function () {
      if (isBackingUp) return;
      try {
        backupBtn.disabled = true;
        backupBtn.innerHTML = '<span class="stellasei-backup-loading"></span><span>正在备份...</span>';
        showStatus(panel, '正在备份所有数据，请稍候...', 'info');

        var result = await doBackup('手动备份');
        showStatus(panel, '备份成功！大小: ' + formatSize(result.size), 'success');
        refreshBackupList(panel);
      } catch (err) {
        showStatus(panel, '备份失败: ' + err.message, 'error');
      } finally {
        backupBtn.disabled = false;
        backupBtn.innerHTML = '<span>📦 立即备份所有数据</span>';
      }
    });

    // 自动备份开关
    var toggle = overlay.querySelector('#stellasei-auto-toggle');
    var freqRow = overlay.querySelector('#stellasei-freq-row');
    toggle.addEventListener('click', function () {
      var enabled = !toggle.classList.contains('active');
      toggle.classList.toggle('active', enabled);
      freqRow.style.display = enabled ? '' : 'none';
      freqRow.style.opacity = enabled ? '1' : '0.5';
      setAutoBackup(enabled);
      showStatus(panel, enabled ? '自动备份已开启' : '自动备份已关闭', 'success');
    });

    // 频率选择
    var freqSelect = overlay.querySelector('#stellasei-freq-select');
    freqSelect.addEventListener('change', function () {
      setAutoBackup(true, freqSelect.value);
      showStatus(panel, '备份频率已更新', 'success');
    });

    // 刷新备份列表
    refreshBackupList(panel);
  }

  // ==================== 初始化 ====================

  function init() {
    console.log('[CloudBackup] 模块加载中...');

    // 初始化 Supabase 客户端
    initSupabase();

    // 添加设置页面云端备份按钮的点击事件
    setTimeout(function () {
      var btn = document.getElementById('miya-st-cloud-backup');
      if (btn) {
        btn.addEventListener('click', showBackupPanel);
        console.log('[CloudBackup] 已绑定设置页面云端备份按钮');
      }
    }, 2000);

    // 延迟检查自动备份（等页面加载完成后）
    setTimeout(function () {
      checkAutoBackup();
      // 每小时检查一次是否需要自动备份
      setInterval(checkAutoBackup, 60 * 60 * 1000);
    }, 5000);

    console.log('[CloudBackup] 模块加载完成');
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ==================== 暴露全局接口 ====================
  global.StellaseiCloudBackup = {
    // 备份与恢复
    doBackup: doBackup,
    doRestore: doRestore,
    getBackupList: getBackupList,
    deleteBackup: deleteBackup,

    // 自动备份
    setAutoBackup: setAutoBackup,
    getAutoBackupSettings: getAutoBackupSettings,

    // UI界面
    showBackupPanel: showBackupPanel,

    // 状态
    isBackingUp: function () { return isBackingUp; },
    isRestoring: function () { return isRestoring; }
  };

})(window);
