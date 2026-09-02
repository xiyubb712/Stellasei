/**
 * 应用管理 - 控制主屏幕显示哪些应用
 * 可以选择把哪些应用添加到主屏幕，把不想要的应用隐藏
 */

(function () {
  'use strict';

  var STORAGE_KEY = 'miya-app-visibility-v1';

  // 所有可用的应用列表
  var ALL_APPS = [
    { id: 'chat', name: '聊天', icon: 'chat', category: '核心' },
    { id: 'contacts', name: '联系人', icon: 'contacts', category: '核心' },
    { id: 'couple', name: '情侣空间', icon: 'couple', category: '核心' },
    { id: 'memory', name: '记忆', icon: 'memory', category: '核心' },
    { id: 'book', name: '世界书', icon: 'book', category: '核心' },
    { id: 'set', name: '设置', icon: 'set', category: '核心' },
    { id: 'beauty', name: '美化', icon: 'beauty', category: '核心' },
    { id: 'music', name: '音乐', icon: 'music', category: '娱乐' },
    { id: 'memo', name: '论坛', icon: 'memo', category: '娱乐' },
    { id: 'store', name: '线下', icon: 'store', category: '娱乐' },
    { id: 'theater', name: '影院', icon: 'theater', category: '娱乐' },
    { id: 'weather', name: '天气', icon: 'weather', category: '工具' },
    { id: 'map', name: '地图', icon: 'map', category: '工具' },
    { id: 'itinerary', name: '行程', icon: 'itinerary', category: '工具' },
    { id: 'notes', name: '笔记', icon: 'notes', category: '工具' },
    { id: 'pet', name: '宠物', icon: 'pet', category: '工具' },
    { id: 'quotes', name: '语录库', icon: 'quotes', category: '星绥专属' },
    { id: 'companion', name: '陪伴系统', icon: 'companion', category: '星绥专属' },
    { id: 'apps', name: '应用管理', icon: 'apps', category: '系统', alwaysShow: true }
  ];

  // 默认显示的应用（第一次使用时）
  var DEFAULT_VISIBLE = [
    'chat', 'contacts', 'couple', 'memory', 'book', 'set', 'beauty',
    'music', 'memo', 'store', 'quotes', 'companion', 'apps'
  ];

  // 读取应用可见性设置
  function getVisibility() {
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        // 确保所有应用都有设置
        ALL_APPS.forEach(function (app) {
          if (typeof parsed[app.id] === 'undefined') {
            parsed[app.id] = DEFAULT_VISIBLE.indexOf(app.id) !== -1;
          }
        });
        return parsed;
      }
    } catch (e) {
      console.log('读取应用可见性失败:', e);
    }
    // 默认设置
    var defaultVis = {};
    ALL_APPS.forEach(function (app) {
      defaultVis[app.id] = DEFAULT_VISIBLE.indexOf(app.id) !== -1;
    });
    return defaultVis;
  }

  // 保存应用可见性设置
  function saveVisibility(visibility) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
    } catch (e) {
      console.log('保存应用可见性失败:', e);
    }
  }

  // 检查应用是否可见
  function isAppVisible(appId) {
    var visibility = getVisibility();
    var app = ALL_APPS.find(function (a) { return a.id === appId; });
    if (app && app.alwaysShow) return true;
    return visibility[appId] !== false; // 默认可见
  }

  // 切换应用可见性
  function toggleAppVisibility(appId) {
    var visibility = getVisibility();
    visibility[appId] = !visibility[appId];
    saveVisibility(visibility);
    applyVisibilityToHome();
    return visibility[appId];
  }

  // 应用可见性设置到主屏幕
  function applyVisibilityToHome() {
    var visibility = getVisibility();
    // 隐藏所有主屏幕上的应用按钮
    var appButtons = document.querySelectorAll('[data-app]');
    appButtons.forEach(function (btn) {
      var appId = btn.getAttribute('data-app');
      var app = ALL_APPS.find(function (a) { return a.id === appId; });
      if (app && app.alwaysShow) {
        btn.style.display = '';
        return;
      }
      if (visibility[appId] === false) {
        btn.style.display = 'none';
      } else {
        btn.style.display = '';
      }
    });
  }

  // 按分类分组应用
  function groupAppsByCategory() {
    var groups = {};
    ALL_APPS.forEach(function (app) {
      if (!groups[app.category]) {
        groups[app.category] = [];
      }
      groups[app.category].push(app);
    });
    return groups;
  }

  // 渲染应用管理页面
  function renderAppManager() {
    var container = document.getElementById('app-manager-body');
    if (!container) return;

    var visibility = getVisibility();
    var groups = groupAppsByCategory();
    var html = '';

    Object.keys(groups).forEach(function (category) {
      html += '<div class="app-manager-category">';
      html += '<h3 class="app-manager-category-title">' + category + '</h3>';
      html += '<div class="app-manager-list">';

      groups[category].forEach(function (app) {
        var isVisible = visibility[app.id] !== false;
        var isDisabled = app.alwaysShow ? 'disabled' : '';
        html += '<div class="app-manager-item ' + (isVisible ? 'is-visible' : 'is-hidden') + '" data-app-id="' + app.id + '">';
        html += '<div class="app-manager-icon" data-i="' + app.icon + '"></div>';
        html += '<div class="app-manager-info">';
        html += '<span class="app-manager-name">' + app.name + '</span>';
        html += '<span class="app-manager-status">' + (isVisible ? '已显示在主屏幕' : '已隐藏') + '</span>';
        html += '</div>';
        html += '<label class="app-manager-switch ' + isDisabled + '">';
        html += '<input type="checkbox" ' + (isVisible ? 'checked' : '') + ' ' + isDisabled + ' data-app-id="' + app.id + '">';
        html += '<span class="app-manager-switch-slider"></span>';
        html += '</label>';
        html += '</div>';
      });

      html += '</div>';
      html += '</div>';
    });

    container.innerHTML = html;

    // 绑定开关事件
    var switches = container.querySelectorAll('.app-manager-switch input[type="checkbox"]');
    switches.forEach(function (sw) {
      sw.addEventListener('change', function (e) {
        var appId = e.target.getAttribute('data-app-id');
        var isVisible = toggleAppVisibility(appId);
        var item = e.target.closest('.app-manager-item');
        var status = item.querySelector('.app-manager-status');
        if (isVisible) {
          item.classList.add('is-visible');
          item.classList.remove('is-hidden');
          status.textContent = '已显示在主屏幕';
        } else {
          item.classList.add('is-hidden');
          item.classList.remove('is-visible');
          status.textContent = '已隐藏';
        }
      });
    });

    // 填充图标
    if (window.miyaFillAppIcons) {
      window.miyaFillAppIcons(container);
    }
  }

  // 打开应用管理页面
  function openAppManager() {
    var modal = document.getElementById('app-manager-modal');
    if (!modal) {
      console.log('应用管理页面不存在');
      return;
    }
    renderAppManager();
    modal.hidden = false;
    document.body.classList.add('app-manager-open');
  }

  // 关闭应用管理页面
  function closeAppManager() {
    var modal = document.getElementById('app-manager-modal');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('app-manager-open');
  }

  // 初始化
  function init() {
    // 页面加载时应用可见性设置
    applyVisibilityToHome();

    // 绑定关闭按钮
    var closeBtn = document.getElementById('app-manager-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', closeAppManager);
    }

    // 点击背景关闭
    var modal = document.getElementById('app-manager-modal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target.id === 'app-manager-modal') {
          closeAppManager();
        }
      });
    }

    // 暴露全局函数
    window.miyaAppManager = {
      open: openAppManager,
      close: closeAppManager,
      isAppVisible: isAppVisible,
      toggleAppVisibility: toggleAppVisibility,
      applyVisibilityToHome: applyVisibilityToHome,
      getAllApps: function () { return ALL_APPS; }
    };
  }

  // DOM加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
