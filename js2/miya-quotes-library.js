/**
 * 语录库应用 - 核心数据与读取逻辑
 * 第一阶段：基础框架（数据结构 + 默认预设 + 读取函数）
 */

(function () {
  'use strict';

  // ========== 数据结构设计 ==========
  // 语录库按以下层级组织：
  // - 功能栏位（companion陪伴 / couple情侣对话 / 通用）
  //   - 角色ID
  //     - 场景（study/work/rest/meal/sleep/chill/general）
  //       - 语录数组

  var STORAGE_KEY = 'miya-quotes-library-v1';

  // ========== 默认预设语录库 ==========
  var DEFAULT_QUOTES = {
    // 陪伴系统语录
    companion: {
      // 通用角色（没有专属语录时用这个）
      default: {
        study: [
          "今天也要好好学习哦，我会在旁边陪着你的。",
          "专注一点，遇到不懂的可以问问我呀。",
          "累了就休息一下，别太拼了。",
          "你认真学习的样子真好看。",
          "再坚持一下，马上就完成了。",
          "学习辛苦了，要不要喝点水？",
          "我相信你一定可以的，加油。",
          "今天学了什么呀？可以讲给我听吗？",
          "别走神哦，我在看着你呢。",
          "学完这一段我们就休息一下好不好？"
        ],
        work: [
          "工作加油哦，我会一直陪着你的。",
          "别太累了，记得休息一下眼睛。",
          "你认真工作的样子真帅。",
          "再忙也要记得吃饭哦。",
          "工作辛苦了，要不要我给你捶捶背？",
          "别着急，一步一步来，你可以的。",
          "累了就看看我，我一直在呢。",
          "今天工作顺利吗？有什么不开心的可以跟我说。",
          "别太拼了，身体最重要哦。",
          "快下班了，再坚持一下！"
        ],
        rest: [
          "好好休息吧，什么都别想。",
          "累了就睡一会儿，我陪着你。",
          "休息的时候就好好放松，别想工作的事。",
          "要不要我给你讲个故事？",
          "你休息的样子真可爱。",
          "别玩手机了，闭上眼睛休息一下。",
          "休息好了才有力气继续加油呀。",
          "要不要听点轻音乐放松一下？",
          "我就在这里，你安心休息。",
          "睡醒了记得告诉我哦。"
        ],
        meal: [
          "好好吃饭哦，别挑食。",
          "今天吃什么呀？好吃吗？",
          "多吃一点，你太瘦了。",
          "吃饭的时候别玩手机，专心吃。",
          "要不要我喂你吃呀？",
          "吃完饭记得休息一下，别马上运动。",
          "今天的菜合口味吗？",
          "多吃点蔬菜，对身体好。",
          "慢慢吃，别着急，没人跟你抢。",
          "吃完饭要不要吃点水果？"
        ],
        sleep: [
          "晚安，做个好梦。",
          "早点睡哦，别熬夜了。",
          "我会在梦里陪着你的。",
          "睡觉的时候别踢被子哦。",
          "要不要我给你讲个睡前故事？",
          "闭上眼睛，慢慢呼吸，我在呢。",
          "今天辛苦了，好好睡一觉。",
          "睡不着的话可以跟我说话哦。",
          "晚安，明天见，我爱你。",
          "把手机放下，乖乖睡觉哦。"
        ],
        chill: [
          "发发呆也挺好的，什么都别想。",
          "要不要一起听听歌？",
          "放松一下，今天什么都不用做。",
          "想什么呢？可以跟我说说呀。",
          "就这样安安静静地待着也挺好的。",
          "要不要出去走走？天气挺好的。",
          "想做什么就做什么，我陪着你。",
          "发呆的时候也在想我吗？",
          "累了就什么都别想，好好放空一下。",
          "我就在这里，你想怎么样都可以。"
        ]
      }
    },

    // 情侣空间对话（左边角色说的，右边你说的）
    couple: {
      default: {
        general: [
          { left: "在干嘛呢？", right: "在想你呀。" },
          { left: "今天想我了吗？", right: "当然想了，每时每刻都在想。" },
          { left: "吃饭了吗？", right: "吃了，你呢？有没有好好吃饭？" },
          { left: "早点睡哦，别熬夜。", right: "知道啦，你也是，晚安。" },
          { left: "今天好累啊。", right: "辛苦了，抱抱你，好好休息一下。" },
          { left: "你在干嘛？怎么不回我消息？", right: "刚刚在忙，现在有空啦，怎么了想我啦？" },
          { left: "周末要不要一起出去玩？", right: "好呀好呀，去哪里玩？" },
          { left: "我好想你啊。", right: "我也好想你，马上就能见面了。" },
          { left: "今天天气真好。", right: "是呀，适合跟你一起出去走走。" },
          { left: "你今天真好看。", right: "讨厌，就你嘴甜。" }
        ]
      }
    }
  };

  // ========== 语录库核心对象 ==========
  var QuotesLibrary = {
    // 初始化
    init: function () {
      try {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (!saved) {
          // 第一次使用，保存默认预设
          localStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_QUOTES));
        }
      } catch (e) {
        console.error('语录库初始化失败:', e);
      }
    },

    // 获取整个语录库数据
    getAll: function () {
      try {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          return JSON.parse(saved);
        }
      } catch (e) {
        console.error('读取语录库失败:', e);
      }
      return DEFAULT_QUOTES;
    },

    // 保存整个语录库数据
    saveAll: function (data) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
      } catch (e) {
        console.error('保存语录库失败:', e);
        return false;
      }
    },

    /**
     * 获取随机语录
     * @param {string} category - 分类：companion（陪伴）/ couple（情侣对话）
     * @param {string} characterId - 角色ID，没有则用 default
     * @param {string} scene - 场景：study/work/rest/meal/sleep/chill/general
     * @returns {string|object} 随机语录（陪伴是字符串，情侣对话是{left,right}对象）
     */
    getRandom: function (category, characterId, scene) {
      var data = this.getAll();
      var catData = data[category] || {};
      var charData = catData[characterId] || catData['default'] || {};
      var sceneQuotes = charData[scene] || charData['general'] || [];

      if (sceneQuotes.length === 0) {
        // 兜底：用默认预设
        var defaultCat = DEFAULT_QUOTES[category] || {};
        var defaultChar = defaultCat['default'] || {};
        sceneQuotes = defaultChar[scene] || defaultChar['general'] || [];
      }

      if (sceneQuotes.length === 0) {
        return category === 'couple' ? { left: '...', right: '...' } : '...';
      }

      var randomIndex = Math.floor(Math.random() * sceneQuotes.length);
      return sceneQuotes[randomIndex];
    },

    /**
     * 添加语录
     * @param {string} category - 分类
     * @param {string} characterId - 角色ID
     * @param {string} scene - 场景
     * @param {string|object} quote - 语录内容
     */
    addQuote: function (category, characterId, scene, quote) {
      var data = this.getAll();
      if (!data[category]) data[category] = {};
      if (!data[category][characterId]) data[category][characterId] = {};
      if (!data[category][characterId][scene]) data[category][characterId][scene] = [];
      data[category][characterId][scene].push(quote);
      return this.saveAll(data);
    },

    /**
     * 重置为默认预设
     */
    resetToDefault: function () {
      return this.saveAll(DEFAULT_QUOTES);
    }
  };

  // 初始化
  QuotesLibrary.init();

  // 动态注册语录库应用的图标和名字
  try {
    if (typeof SVG_CLASSIC !== 'undefined') {
      SVG_CLASSIC.quotes = '<svg viewBox="0 0 24 24" fill="none"><path d="M9.5 7H6.5C5.12 7 4 8.12 4 9.5v2C4 12.88 5.12 14 6.5 14h1v2.5l3-2.5V9.5C10.5 8.12 9.38 7 8 7h1.5z" fill="rgba(70,74,80,0.75)" stroke="rgba(70,74,80,0.82)" stroke-width="0.8" stroke-linejoin="round"/><path d="M19.5 7h-3C15.12 7 14 8.12 14 9.5v2c0 1.38 1.12 2.5 2.5 2.5h1v2.5l3-2.5V9.5C20.5 8.12 19.38 7 18 7h1.5z" fill="rgba(70,74,80,0.75)" stroke="rgba(70,74,80,0.82)" stroke-width="0.8" stroke-linejoin="round"/><path d="M5 19h14" stroke="rgba(130,136,145,0.65)" stroke-width="1.1" stroke-linecap="round"/></svg>';
    }
    if (typeof NAMES !== 'undefined') {
      NAMES.quotes = '语录库';
    }
  } catch (e) {
    console.log('语录库应用注册跳过（SVG/NAMES 未加载）');
  }

  // 暴露到全局
  var globalObj = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);
  globalObj.miyaQuotesLibrary = QuotesLibrary;

  console.log('语录库已加载 - 第一阶段基础框架完成');
})();
