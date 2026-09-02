/**
 * miya-couple-health.js — 健康体检报告 · UI
 */
(function (global) {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    contactId: '',
    busy: false,
    lastReport: null,
    saved: false
  };

  function store() { return global.miyaCoupleStore || null; }
  function chatStore() { return global.miyaChatStore || null; }
  function contactsStore() { return global.miyaContactsStore || null; }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function toast(msg) {
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.toast === 'function') {
      global.miyaCoupleApp.toast(msg);
      return;
    }
    var el = $('cp-toast');
    if (!el) return;
    el.textContent = String(msg || '');
    el.classList.add('is-show');
    setTimeout(function () { el.classList.remove('is-show'); }, 2400);
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  // 获取API配置
  function getApiConfig() {
    if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
    return {};
  }

  // 处理baseUrl（修复：不会重复添加/v1）
  function normalizeBaseUrl(t) {
    t = String(t || '').trim();
    if (!t) return '';
    try {
      var u = new URL(t);
      var path = u.pathname || '/';
      // 如果已经以/v1结尾，就不重复添加
      if (path.toLowerCase().endsWith('/v1')) {
        return u.origin + path;
      }
      // 如果path是根路径，直接加/v1
      if (path === '/' || path === '') {
        return u.origin + '/v1';
      }
      // 其他情况，在path后面加/v1
      return u.origin + path + '/v1';
    } catch (e) {
      // 非标准URL格式，检查是否已经以/v1结尾
      return t.toLowerCase().endsWith('/v1') ? t : t + '/v1';
    }
  }

  // 获取角色设定（现在联系人本身就有persona、gender、birthday等信息）
  function getProfileForContact(contactId) {
    // 直接返回联系人信息，因为联系人本身就包含了所有需要的角色档案信息
    return getContact(contactId);
  }

  // 获取聊天记录（最近的私聊消息）
  function getRecentMessages(contactId, limit) {
    var st = chatStore();
    if (!st || !contactId) return [];
    limit = limit || 50;
    try {
      // 获取联系人对应的私聊
      var chats = st.getChats ? st.getChats() : [];
      var chat = chats.find(function (c) {
        return c && c.contactId === contactId && c.type !== 'group';
      });
      if (!chat) return [];
      var messages = st.getMessages ? st.getMessages(chat.id) : [];
      // 取最近的limit条消息
      return messages.slice(-limit).map(function (m) {
        return {
          role: m.role || (m.sender === 'user' ? 'user' : 'assistant'),
          content: String(m.content || '').slice(0, 500)
        };
      }).filter(function (m) { return m.content && m.content.trim(); });
    } catch (e) {
      console.error('获取聊天记录失败：', e);
      return [];
    }
  }

  // 通过联系人ID获取对应的私聊chatId
  function getChatIdByContactId(contactId) {
    var st = chatStore();
    if (!st || !contactId) return null;
    try {
      var chats = st.getChats ? st.getChats() : [];
      var chat = chats.find(function (c) {
        return c && c.contactId === contactId && c.type !== 'group';
      });
      return chat ? chat.id : null;
    } catch (e) {
      return null;
    }
  }

  // 构建体检报告提示词
  function buildHealthPrompt(contact, profile, messages) {
    // 现在contact本身就是完整的角色档案，包含persona、age、gender、birthday、tags等
    var contactName = (contact && contact.name) || '未知';
    var contactGender = (contact && contact.gender) || '未知';
    var contactAge = (contact && contact.age) || '';
    var contactBirthday = (contact && contact.birthday) || '未知';
    var contactPersona = (contact && contact.persona) || '';
    var contactTags = (contact && contact.tags) || [];

    // 角色设定信息（关键：persona是AI理解角色的核心）
    var profileInfo = '';
    if (contact) {
      profileInfo = '\n【角色设定 · 核心信息】\n';
      if (contact.name) profileInfo += '姓名：' + contact.name + '\n';
      if (contact.gender) profileInfo += '性别：' + contact.gender + '\n';
      if (contact.age) profileInfo += '年龄：' + contact.age + '\n';
      if (contact.birthday) profileInfo += '生日：' + contact.birthday + '\n';
      if (contactTags && contactTags.length) profileInfo += '标签：' + contactTags.join('、') + '\n';
      if (contactPersona) profileInfo += '\n【人设与背景（persona）】\n' + contactPersona + '\n';
    }

    // 长期记忆（从聊天设置中获取）
    var memoryText = '';
    try {
      var chatStore = window.miyaChatStore;
      var memoryExtract = window.MiyaChatMemoryExtract;
      var chatId = getChatIdByContactId(contact && contact.id);
      if (chatStore && memoryExtract && chatId) {
        var chatSettings = chatStore.getChatSettings(chatId);
        if (chatSettings && typeof memoryExtract.buildCharMemoryContextBlock === 'function') {
          memoryText = memoryExtract.buildCharMemoryContextBlock(chatSettings);
        }
      }
    } catch (e) {
      console.error('获取记忆失败：', e);
    }

    // 合卷总结（从聊天设置中获取，只取合卷，不取分镜）
    var megaSummaryText = '';
    try {
      var chatStore2 = window.miyaChatStore;
      var chatId2 = getChatIdByContactId(contact && contact.id);
      if (chatStore2 && chatId2) {
        var chatSettings2 = chatStore2.getChatSettings(chatId2);
        var megaList = chatSettings2 && Array.isArray(chatSettings2.megaSummaryList) ? chatSettings2.megaSummaryList : [];
        if (megaList.length) {
          megaSummaryText = '\n【长期记忆·合卷总结】\n';
          megaSummaryText += '以下为已沉淀的合卷总结（多个分镜的合并精炼），包含重要的习惯变化、关系变化和重要事件，请结合角色记忆和近期聊天记录使用。\n\n';
          megaList.forEach(function (row, i) {
            var body = String((row && row.content) || '').trim();
            if (!body) return;
            megaSummaryText += '【合卷' + (i + 1) + ' · 消息' + (row.startIndex || '?') + '-' + (row.endIndex || '?') + '】\n';
            megaSummaryText += body + '\n\n';
          });
        }
      }
    } catch (e) {
      console.error('获取合卷总结失败：', e);
    }

    // 聊天记录摘要
    var messagesText = '';
    if (messages && messages.length) {
      messagesText = '\n【最近聊天记录（共' + messages.length + '条）】\n';
      messages.forEach(function (m, i) {
        var role = m.role === 'user' ? '用户（另一半）' : contactName;
        messagesText += '[' + (i + 1) + '] ' + role + '：' + m.content + '\n';
      });
    }

    var systemPrompt = '你是星绥健康管理局的专业体检医生，需要根据角色设定、人设与背景、记忆和聊天记录，生成一份专业但通俗易懂、内容丰富详细的健康体检报告。' +
      '【数据优先级 - 必须严格遵守】：' +
      '1. 第一优先级：人物设定（人设与背景）- 这是角色的基础属性，包括基本信息、性格特点、饮食习惯、兴趣爱好等，是生成报告的基础依据。' +
      '2. 第二优先级：角色记忆 - 这是从对话中提炼的、对角色重要的记忆片段，包括角色的习惯、喜好、重要经历等，可以补充和覆盖人物设定中的内容。' +
      '3. 第三优先级：合卷总结 - 这是多个分镜总结的合并精炼，包含重要的习惯变化、关系变化和重要事件。比如人物设定说喜欢吃意大利面，但合卷总结里记录角色因为用户喜欢吃甜食而去学习做甜点，那饮食习惯就应该以合卷总结为准。' +
      '4. 第四优先级：聊天记录 - 这是角色近期的状态和情绪变化，主要用于评估心理状态、情绪波动、近期生活习惯等动态变化的内容。' +
      '【重要】基础属性（身高、体重、血型、年龄等）默认以人物设定为准，但如果记忆或聊天记录中有明确提到变化（比如"最近吃胖了"、"感觉长高了"、"体重增加了"等），应该根据这些信息合理调整，并在描述中体现变化趋势（比如"近期体重略有上升"）。注意：必须有明确依据才能更改，不能随意猜测。' +
      '【重要】必须深入理解角色的人设与背景（persona），结合记忆和聊天记录中的具体表现和具体事件，生成有针对性、个性化的报告，绝对不要生成通用模板或简短的套话。' +
      '报告需要包含：基础健康评估（身高、体重、BMI、血压、心率、血型、体温、睡眠质量、精神状态、食欲情况、疲劳程度）、' +
      '心理状态（精神面貌、情绪状态、压力应对、关系支持-对另一半的感觉、认知思维）、' +
      '生活习惯（作息规律、饮食习惯、运动习惯、兴趣爱好、社交活动）、' +
      '医生总结和照顾建议。' +
      '【内容丰富度要求 - 必须严格遵守】：' +
      '1. 每个评估项的value都必须是具体、详细的描述，至少10-20个字，绝对不能只用一个词或短语（如不能只写"良好"、"正常"、"集中"），要结合角色的性格特点和聊天记录中的具体表现进行描述。' +
      '2. 生理数据要合理，可以根据人设与背景合理推断身高、体重等指标，但【重要】直接给出实测数值，绝对不要说明推断依据，不要写"根据...推断"这种话，就像真实医院体检报告一样，直接给出测量结果。' +
      '3. 语言专业但通俗易懂，不要用太生僻的医学术语，要用普通人能听懂的话解释。' +
      '4. 如果某些信息无法从设定和记录中推断，填写"待补充"，但尽量根据人设合理推断，不要轻易写待补充。' +
      '5. 医生总结要详略得当，控制在100-130字左右，要结合角色的具体性格和聊天表现进行综合分析，要有重点，不要泛泛而谈，也不要过于冗长。' +
      '6. 照顾建议要具体实用，3-5条即可（优先3条），每条都要针对角色的具体问题，给出可操作的建议，不要写空泛的套话。' +
      '7. 心理评估要深入，结合人设分析角色的内心活动、情绪状态、压力来源、对另一半的真实感受等，要有细节，不要只写表面现象。' +
      '8. 每个分类的整体评估（bodySummary、mentalSummary、lifestyleSummary）都要详细，至少50字，要具体说明为什么是这个评分，有哪些具体表现。' +
      '请严格按照JSON格式返回，不要返回其他内容。';

    var userPrompt = '请为以下角色生成健康体检报告：\n' +
      '【基本信息】\n' +
      '姓名：' + contactName + '\n' +
      '性别：' + contactGender + '\n' +
      (contactAge ? '年龄：' + contactAge + '\n' : '') +
      '生日：' + contactBirthday + '\n' +
      profileInfo +
      (memoryText ? '\n' + memoryText + '\n' : '') +
      (megaSummaryText ? megaSummaryText + '\n' : '') +
      messagesText +
      '\n请生成JSON格式的体检报告，格式如下（注意每个value都要详细描述，不要只用一个词）：\n' +
      '{\n' +
      '  "bodyScore": 85,\n' +
      '  "bodySummary": "基础健康状况整体良好，各项生理指标基本在正常范围内。身高体重比例协调，近期作息基本规律，但工作压力较大导致偶有睡眠质量下降，需要注意劳逸结合。",\n' +
      '  "bodyTag": "良好",\n' +
      '  "bodyMetrics": {\n' +
      '    "height": "183cm",\n' +
      '    "weight": "约72kg，体型匀称偏瘦",\n' +
      '    "bmi": "21.5，属于正常范围",\n' +
      '    "bloodPressure": "118/76mmHg，在正常范围内，近期压力大时可能略有波动",\n' +
      '    "heartRate": "72次/分，心律齐，运动后恢复较快",\n' +
      '    "bloodType": "待补充",\n' +
      '    "temperature": "36.5℃，基础体温正常",\n' +
      '    "sleepQuality": "整体良好，但近期工作繁忙时偶有入睡困难，深度睡眠时长略有不足",\n' +
      '    "mentalState": "白天精神状态尚可，但下午容易出现疲劳感，需要靠咖啡提神",\n' +
      '    "appetite": "三餐基本规律，但忙碌时常忘记吃饭，偏好清淡口味，饮水量充足",\n' +
      '    "fatigue": "存在轻度疲劳感，主要源于工作压力和睡眠不足，周末休息后可缓解"\n' +
      '  },\n' +
      '  "mentalScore": 82,\n' +
      '  "mentalSummary": "心理状态整体良好，性格自信沉稳，情绪调节能力较强。近期虽然面临较大的工作压力，但能够通过自我调节保持情绪稳定。与另一半的关系亲密，情感支持系统完善，对心理健康有积极影响。",\n' +
      '  "mentalTag": "良好",\n' +
      '  "mentalCategories": [\n' +
      '    { "title": "精神面貌", "items": [ { "label": "外表仪态", "value": "总是穿着整洁得体，注重细节搭配，给人专业可靠的印象，即使忙碌也会保持良好的个人形象" }, { "label": "注意力", "value": "工作时注意力高度集中，能够长时间专注于复杂任务，但疲劳时容易出现注意力涣散" } ] },\n' +
      '    { "title": "情绪状态", "items": [ { "label": "整体情绪", "value": "以平稳愉悦为主，性格温和内敛，不轻易表露情绪，但在亲近的人面前会展现出温柔的一面" }, { "label": "情绪波动", "value": "情绪波动较小，能够较好地控制情绪，但工作压力过大时会出现短暂的烦躁和焦虑" } ] },\n' +
      '    { "title": "压力应对", "items": [ { "label": "压力水平", "value": "中等偏上，主要来源于工作项目的推进和对自我的高要求" }, { "label": "主要来源", "value": "工作项目压力、对完美的追求、以及希望给另一半更好生活的责任感" }, { "label": "应对方式", "value": "主要通过自我调节和独处来缓解压力，偶尔会向另一半倾诉，运动也是重要的减压方式" } ] },\n' +
      '    { "title": "关系支持", "items": [ { "label": "对另一半的感觉", "value": "非常依赖且信任，认为另一半是自己最重要的精神支柱，在对方面前可以完全放松，展现真实的自己" }, { "label": "社交支持", "value": "社交圈不大但质量高，有几个可以交心的朋友，社交活动适度，不喜欢过于喧闹的场合" } ] },\n' +
      '    { "title": "认知思维", "items": [ { "label": "思维清晰度", "value": "思维清晰敏捷，逻辑分析能力强，能够快速抓住问题的核心并提出解决方案" }, { "label": "决策能力", "value": "决策果断且理性，善于权衡利弊，但在涉及感情的问题上会变得更加谨慎和温柔" } ] }\n' +
      '  ],\n' +
      '  "lifestyleScore": 78,\n' +
      '  "lifestyleSummary": "生活习惯整体尚可，作息基本规律，饮食习惯良好，但运动量略有不足。工作繁忙时常会忽略身体发出的疲劳信号，需要更加注重工作与生活的平衡，培养更健康的生活方式。",\n' +
      '  "lifestyleTag": "尚可",\n' +
      '  "lifestyleCategories": [\n' +
      '    { "title": "作息规律", "items": [ { "label": "入睡时间", "value": "通常在23:30左右入睡，但忙碌时会推迟到凌晨1点以后" }, { "label": "起床时间", "value": "早上7:30左右起床，周末会适当晚起补充睡眠" }, { "label": "作息规律度", "value": "工作日基本规律，但加班时会出现作息紊乱，需要注意调整" } ] },\n' +
      '    { "title": "饮食习惯", "items": [ { "label": "三餐规律", "value": "三餐基本规律，但忙碌时常会跳过早餐或晚餐，需要更加注意按时吃饭" }, { "label": "饮食偏好", "value": "偏好清淡口味，喜欢蔬菜水果，不喜欢过于油腻的食物，偶尔会和另一半一起尝试新餐厅" }, { "label": "饮水量", "value": "饮水量充足，有随身携带水杯的习惯，每天饮水量约2000ml" } ] },\n' +
      '    { "title": "运动习惯", "items": [ { "label": "运动频率", "value": "每周2-3次，主要集中在周末，工作日因工作繁忙较少运动" }, { "label": "运动类型", "value": "喜欢慢跑和健身，偶尔会和另一半一起散步或骑行，不喜欢过于剧烈的运动" }, { "label": "运动量", "value": "略有不足，建议增加工作日的运动频次，每次30分钟以上即可" } ] },\n' +
      '    { "title": "兴趣爱好", "items": [ { "label": "主要爱好", "value": "喜欢阅读和音乐，闲暇时会看书、听黑胶唱片，也喜欢收集一些有质感的小物件" }, { "label": "投入程度", "value": "投入程度适中，能够在忙碌的工作中抽出时间享受爱好，爱好也是重要的减压方式" } ] },\n' +
      '    { "title": "社交活动", "items": [ { "label": "社交频率", "value": "社交频率适中，不喜欢过于频繁的社交活动，更倾向于小范围的深度交流" }, { "label": "社交质量", "value": "社交质量较高，朋友不多但都是可以交心的挚友，与同事关系也相处融洽" } ] }\n' +
      '  ],\n' +
      '  "doctorSummary": "该角色整体健康状况良好，基础生理指标基本正常，心理状态稳定，具备良好的情绪调节能力。角色性格沉稳内敛，对自我要求较高，工作压力较大但能通过自我调节保持平衡。与另一半关系亲密，情感支持完善。生活习惯基本健康，但运动量略有不足，建议注意劳逸结合，增加户外活动，保持良好的身心状态。",\n' +
      '  "advice": [\n' +
      '    "建议每周增加2-3次工作日的运动，可以选择午休散步或下班后慢跑30分钟，不要把运动都集中在周末。",\n' +
      '    "保持规律作息，尽量在23:00前入睡，保证7-8小时睡眠，工作再忙也不要超过凌晨1点，避免过度透支身体。",\n' +
      '    "建议和另一半一起培养一项共同的户外运动爱好，比如周末骑行、徒步，既增进感情又能锻炼身体、缓解工作压力。"\n' +
      '  ]\n' +
      '}';

    return {
      system: systemPrompt,
      user: userPrompt
    };
  }

  // 构建浓缩提示词
  function buildSummaryPrompt(report, contact) {
    var name = (contact && (contact.name || contact.remarkName)) || '角色';
    var now = new Date();
    var dateStr = (now.getMonth() + 1) + '月' + now.getDate() + '日';

    var reportText = buildReportMemoryText(report, contact);

    return {
      system: '你是一位专业的健康管理师，擅长把复杂的体检报告浓缩成简洁、有重点的健康档案摘要。你的任务是阅读完整的体检报告，提炼出最重要、最关键的信息，去除重复和冗余的描述，生成一份300-500字的健康档案摘要。摘要要包含：整体健康状况、关键生理指标、需要注意的问题、心理状态、生活习惯、医生重点建议。语言要专业但易懂，有逻辑，有重点。',
      user: '请把以下这份' + name + '的体检报告（体检日期：' + dateStr + '）浓缩成300-500字的健康档案摘要。要求：\n1. 提炼最重要、最关键的信息，去除重复和冗余\n2. 包含整体健康状况、关键指标、需要注意的问题、心理状态、生活习惯、医生重点建议\n3. 语言专业但易懂，有逻辑，有重点\n4. 不要分太多小标题，用段落式描述，重点内容可以加粗\n5. 最后用JSON格式返回，格式为 {"summary": "浓缩后的摘要内容"}\n\n完整体检报告如下：\n\n' + reportText
    };
  }

  // 调用AI浓缩报告
  function callAIForSummary(report, contact) {
    var cfg = getApiConfig();
    var baseUrl = normalizeBaseUrl(cfg.baseUrl);
    var apiKey = String(cfg.apiKey || '').trim();
    var model = String(cfg.model || '').trim();

    if (!baseUrl || !apiKey || !model) {
      return Promise.reject(new Error('API未配置'));
    }

    var prompt = buildSummaryPrompt(report, contact);
    var url = baseUrl + '/chat/completions';
    var headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    };
    var payload = {
      model: model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      temperature: cfg.temperature != null ? Number(cfg.temperature) : 0.5,
      response_format: { type: 'json_object' }
    };

    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('API请求失败：' + res.status);
      return res.json();
    }).then(function (data) {
      var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('API返回为空');
      try {
        var parsed = JSON.parse(content);
        return parsed.summary || content;
      } catch (e) {
        var match = content.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            var parsed2 = JSON.parse(match[0]);
            return parsed2.summary || content;
          } catch (e2) {}
        }
        return content;
      }
    });
  }

  // 调用AI生成报告
  function callAIForReport(prompt) {
    var cfg = getApiConfig();
    var baseUrl = normalizeBaseUrl(cfg.baseUrl);
    var apiKey = String(cfg.apiKey || '').trim();
    var model = String(cfg.model || '').trim();

    if (!baseUrl || !apiKey || !model) {
      return Promise.reject(new Error('API未配置，请先在设置中配置API'));
    }

    var url = baseUrl + '/chat/completions';
    var headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    };
    var payload = {
      model: model,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      temperature: cfg.temperature != null ? Number(cfg.temperature) : 0.7,
      response_format: { type: 'json_object' }
    };

    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error('API请求失败：' + res.status);
      return res.json();
    }).then(function (data) {
      var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!content) throw new Error('API返回为空');
      // 尝试解析JSON
      try {
        return JSON.parse(content);
      } catch (e) {
        // 如果解析失败，尝试提取JSON部分
        var match = content.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
        throw new Error('JSON解析失败');
      }
    });
  }

  // 渲染报告到页面
  function renderReport(report) {
    // 基础健康评估
    if ($('cp-health-body-score')) $('cp-health-body-score').textContent = report.bodyScore != null ? report.bodyScore : '-';
    if ($('cp-health-body-summary')) $('cp-health-body-summary').textContent = report.bodySummary || '暂无评估';
    if ($('cp-health-body-tag')) $('cp-health-body-tag').textContent = report.bodyTag || '-';

    // 基础指标
    var metrics = report.bodyMetrics || {};
    var metricCards = document.querySelectorAll('#cp-health-body-metrics .cp-health-metric-card');
    var metricKeys = ['height', 'weight', 'bmi', 'bloodPressure', 'heartRate', 'bloodType', 'temperature', 'sleepQuality', 'mentalState', 'appetite', 'fatigue'];
    metricCards.forEach(function (card, i) {
      var valueEl = card.querySelector('.cp-health-metric-value');
      if (valueEl && metricKeys[i]) {
        valueEl.textContent = metrics[metricKeys[i]] || '待补充';
      }
    });

    // 心理状态
    if ($('cp-health-mental-score')) $('cp-health-mental-score').textContent = report.mentalScore != null ? report.mentalScore : '-';
    if ($('cp-health-mental-summary')) $('cp-health-mental-summary').textContent = report.mentalSummary || '暂无评估';
    if ($('cp-health-mental-tag')) $('cp-health-mental-tag').textContent = report.mentalTag || '-';

    // 心理分类
    var mentalContainer = $('cp-health-mental-categories');
    if (mentalContainer && report.mentalCategories && report.mentalCategories.length) {
      mentalContainer.innerHTML = report.mentalCategories.map(function (cat) {
        var itemsHtml = (cat.items || []).map(function (item) {
          return '<div class="cp-health-metric-card"><div class="cp-health-metric-label">' + esc(item.label) + '</div><div class="cp-health-metric-value">' + esc(item.value) + '</div></div>';
        }).join('');
        return '<div class="cp-health-category"><div class="cp-health-category__title">' + esc(cat.title) + '</div><div class="cp-health-category__grid">' + itemsHtml + '</div></div>';
      }).join('');
    }

    // 生活习惯
    if ($('cp-health-lifestyle-score')) $('cp-health-lifestyle-score').textContent = report.lifestyleScore != null ? report.lifestyleScore : '-';
    if ($('cp-health-lifestyle-summary')) $('cp-health-lifestyle-summary').textContent = report.lifestyleSummary || '暂无评估';
    if ($('cp-health-lifestyle-tag')) $('cp-health-lifestyle-tag').textContent = report.lifestyleTag || '-';

    // 生活习惯分类
    var lifestyleContainer = $('cp-health-lifestyle-categories');
    if (lifestyleContainer && report.lifestyleCategories && report.lifestyleCategories.length) {
      lifestyleContainer.innerHTML = report.lifestyleCategories.map(function (cat) {
        var itemsHtml = (cat.items || []).map(function (item) {
          return '<div class="cp-health-metric-card"><div class="cp-health-metric-label">' + esc(item.label) + '</div><div class="cp-health-metric-value">' + esc(item.value) + '</div></div>';
        }).join('');
        return '<div class="cp-health-category"><div class="cp-health-category__title">' + esc(cat.title) + '</div><div class="cp-health-category__grid">' + itemsHtml + '</div></div>';
      }).join('');
    }

    // 医生总结
    if ($('cp-health-doctor-summary')) $('cp-health-doctor-summary').textContent = report.doctorSummary || '暂无总结';

    // 照顾建议
    var adviceList = $('cp-health-advice');
    if (adviceList && report.advice && report.advice.length) {
      adviceList.innerHTML = report.advice.map(function (a) {
        return '<li>' + esc(a) + '</li>';
      }).join('');
    }
  }

  // 获取联系人完整角色档案（从miyaContactsStore读取）
  function getContact(id) {
    if (!id) return null;
    var cs = contactsStore();
    var chatSt = chatStore();

    // 方法1：直接用id从miyaContactsStore查找角色档案
    if (cs && typeof cs.findCharacter === 'function') {
      var character = cs.findCharacter(id);
      if (character) return character;
    }

    // 方法2：从miyaChatStore获取contact，再用contact.characterId查找
    if (chatSt && typeof chatSt.findContact === 'function') {
      var contact = chatSt.findContact(id);
      if (contact) {
        // 尝试用contact.characterId查找
        if (contact.characterId && cs && typeof cs.findCharacter === 'function') {
          var charByCid = cs.findCharacter(contact.characterId);
          if (charByCid) return charByCid;
        }
        // 尝试用contact.id查找（可能id就是characterId）
        if (cs && typeof cs.findCharacter === 'function') {
          var charById = cs.findCharacter(contact.id);
          if (charById) return charById;
        }
        // 如果还是找不到，返回contact本身（至少有name）
        return contact;
      }
    }

    // 方法3：从miyaContactsStore列出所有角色，按名字匹配
    if (cs && typeof cs.listCharacters === 'function') {
      var allChars = cs.listCharacters() || [];
      // 如果只有一个角色，直接返回
      if (allChars.length === 1) return allChars[0];
      // 如果有多个，尝试按id匹配
      var matched = allChars.find(function (c) {
        return c && (c.id === id || c.characterId === id);
      });
      if (matched) return matched;
    }

    return null;
  }

  // 获取当前激活的联系人ID（优先从miyaCoupleApp获取当前正在查看的联系人）
  function getActiveContactId() {
    // 方法1：从miyaCoupleApp获取当前正在查看的联系人（最准确）
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.getActiveContactId === 'function') {
      var activeId = global.miyaCoupleApp.getActiveContactId();
      if (activeId) return String(activeId);
    }
    // 方法2：从miyaCoupleApp获取选中的联系人
    if (global.miyaCoupleApp && typeof global.miyaCoupleApp.getSelectedContactId === 'function') {
      var selectedId = global.miyaCoupleApp.getSelectedContactId();
      if (selectedId) return String(selectedId);
    }
    // 方法3：从miyaCoupleStore获取所有打开的联系人，取第一个
    var st = store();
    if (st && typeof st.getOpenContactIds === 'function') {
      var ids = st.getOpenContactIds() || [];
      if (ids.length) return String(ids[0]);
    }
    return '';
  }

  // 生成随机报告编号
  function generateReportNo() {
    var now = new Date();
    var year = now.getFullYear();
    var month = pad(now.getMonth() + 1);
    var day = pad(now.getDate());
    var random = String(Math.floor(Math.random() * 900) + 100);
    return 'XS' + year + month + day + random;
  }

  // 获取当前日期
  function getCurrentDate() {
    var now = new Date();
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }

  // 打开健康体检报告页面
  function openHealthReport() {
    var app = $('miya-couple-app');
    var view = $('cp-view-health');
    if (!app || !view) return;

    state.contactId = getActiveContactId();
    var contact = getContact(state.contactId);
    var profile = getProfileForContact(state.contactId);

    // 优先从角色设定（profile）获取信息，其次从联系人（contact）获取
    var name = (profile && profile.name) || (contact && contact.name) || '未知';
    var gender = (profile && profile.gender) || '未知';
    var birthday = (profile && profile.birthday) || '待补充';

    // 填充基本信息
    if ($('cp-health-name')) {
      $('cp-health-name').textContent = name;
    }
    if ($('cp-health-gender')) {
      $('cp-health-gender').textContent = gender;
    }
    if ($('cp-health-birthday')) {
      $('cp-health-birthday').textContent = birthday;
    }
    if ($('cp-health-date')) {
      $('cp-health-date').textContent = getCurrentDate();
    }
    if ($('cp-health-report-id')) {
      $('cp-health-report-id').textContent = 'NO. ' + generateReportNo();
    }

    // 显示页面
    app.classList.add('is-health');
    view.hidden = false;

    // 滚动到顶部
    var scroll = $('cp-health-scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  // 关闭健康体检报告页面
  function closeHealthReport() {
    var app = $('miya-couple-app');
    var view = $('cp-view-health');
    if (!app || !view) return;

    app.classList.remove('is-health');
    view.hidden = true;
  }

  // 生成体检报告
  function generateReport() {
    if (state.busy) return;
    state.busy = true;

    var btn = $('cp-health-generate');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> 生成中...';
    }

    toast('正在生成体检报告，请稍候...');

    var contactId = state.contactId || getActiveContactId();
    var contact = getContact(contactId);
    var profile = getProfileForContact(contactId);
    var messages = getRecentMessages(contactId, 50);

    var prompt = buildHealthPrompt(contact, profile, messages);

    callAIForReport(prompt).then(function (report) {
      renderReport(report);
      state.lastReport = report;
      state.saved = false;
      state.busy = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> 重新生成报告';
      }
      // 启用保存按钮
      var saveBtn = $('cp-health-save');
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg> 保存到记忆';
      }
      toast('体检报告生成成功！');
    }).catch(function (err) {
      console.error('生成体检报告失败：', err);
      state.busy = false;
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> 生成体检报告';
      }
      toast('生成失败：' + (err.message || '未知错误'));
    });
  }

  // 把报告转换成记忆文本
  function buildReportMemoryText(report, contact) {
    if (!report) return '';
    var name = (contact && (contact.name || contact.remarkName)) || '角色';
    var now = new Date();
    var dateStr = (now.getMonth() + 1) + '月' + now.getDate() + '日';

    var lines = [];
    lines.push('【健康体检报告 · ' + dateStr + '】');
    lines.push('体检对象：' + name);
    lines.push('');

    // 基础健康评估
    if (report.bodyScore != null) {
      lines.push('【基础健康评估】');
      lines.push('评分：' + report.bodyScore + '/100');
      if (report.bodySummary) lines.push('整体评估：' + report.bodySummary);
      if (report.bodyTag) lines.push('状态：' + report.bodyTag);
      // 基础指标
      var metrics = report.bodyMetrics || {};
      var metricLabels = {
        height: '身高', weight: '体重', bmi: 'BMI',
        bloodPressure: '血压', heartRate: '心率', bloodType: '血型',
        temperature: '体温', sleepQuality: '睡眠质量',
        mentalState: '精神状态', appetite: '食欲情况', fatigue: '疲劳程度'
      };
      var metricLines = [];
      Object.keys(metricLabels).forEach(function (key) {
        if (metrics[key]) {
          metricLines.push(metricLabels[key] + '：' + metrics[key]);
        }
      });
      if (metricLines.length) {
        lines.push('具体指标：' + metricLines.join('；'));
      }
      lines.push('');
    }

    // 心理状态
    if (report.mentalScore != null) {
      lines.push('【心理状态】');
      lines.push('评分：' + report.mentalScore + '/100');
      if (report.mentalSummary) lines.push('整体评估：' + report.mentalSummary);
      if (report.mentalTag) lines.push('状态：' + report.mentalTag);
      // 心理分类
      if (report.mentalCategories && report.mentalCategories.length) {
        report.mentalCategories.forEach(function (cat) {
          if (cat.title && cat.items && cat.items.length) {
            var itemsStr = cat.items.map(function (item) {
              return item.label + '：' + item.value;
            }).join('；');
            lines.push(cat.title + '：' + itemsStr);
          }
        });
      }
      lines.push('');
    }

    // 生活习惯
    if (report.lifestyleScore != null) {
      lines.push('【生活习惯】');
      lines.push('评分：' + report.lifestyleScore + '/100');
      if (report.lifestyleSummary) lines.push('整体评估：' + report.lifestyleSummary);
      if (report.lifestyleTag) lines.push('状态：' + report.lifestyleTag);
      // 生活习惯分类
      if (report.lifestyleCategories && report.lifestyleCategories.length) {
        report.lifestyleCategories.forEach(function (cat) {
          if (cat.title && cat.items && cat.items.length) {
            var itemsStr = cat.items.map(function (item) {
              return item.label + '：' + item.value;
            }).join('；');
            lines.push(cat.title + '：' + itemsStr);
          }
        });
      }
      lines.push('');
    }

    // 医生总结
    if (report.doctorSummary) {
      lines.push('【医生总结】');
      lines.push(report.doctorSummary);
      lines.push('');
    }

    // 照顾建议
    if (report.advice && report.advice.length) {
      lines.push('【照顾建议】');
      report.advice.forEach(function (a, i) {
        lines.push((i + 1) + '. ' + a);
      });
    }

    return lines.join('\n');
  }

  // 通过 contactId 找到对应的聊天 ID
  function findChatIdByContactId(contactId) {
    var st = chatStore();
    if (!st || !contactId) return null;
    try {
      var chats = st.getChats ? st.getChats() : [];
      var chat = chats.find(function (c) {
        return c && c.contactId === contactId && c.type !== 'group';
      });
      return chat ? chat.id : null;
    } catch (e) {
      return null;
    }
  }

  // 保存报告到角色记忆（只保留一份最新的，先保存完整报告，后台AI浓缩后更新）
  function saveReportToMemory() {
    if (!state.lastReport) {
      toast('请先生成体检报告');
      return;
    }
    if (state.saved) {
      toast('该报告已保存到记忆');
      return;
    }

    var contactId = state.contactId || getActiveContactId();
    var contact = getContact(contactId);
    var chatId = findChatIdByContactId(contactId);

    if (!chatId) {
      toast('未找到对应的聊天记录，无法保存');
      return;
    }

    var st = chatStore();
    if (!st || typeof st.getChatSettings !== 'function' || typeof st.saveChatSettings !== 'function') {
      toast('保存失败：存储服务不可用');
      return;
    }

    try {
      var settings = st.getChatSettings(chatId);
      var memoryList = Array.isArray(settings.charMemoryList) ? settings.charMemoryList : [];

      // 查找并删除旧的健康报告记忆（只保留一份最新的）
      var filteredList = memoryList.filter(function (mem) {
        return !(mem && mem.healthReport === true);
      });

      // 构建完整报告文本（先保存完整报告）
      var fullReportText = buildReportMemoryText(state.lastReport, contact);
      var now = new Date();
      var memoryId = 'cmem_health_' + now.getTime().toString(36);

      // 新的记忆对象，标记为健康报告
      var newMemory = {
        id: memoryId,
        content: fullReportText,
        startIndex: 0,
        endIndex: 0,
        createdAt: now.getTime(),
        healthReport: true,  // 标记为健康报告
        healthReportDate: (now.getMonth() + 1) + '月' + now.getDate() + '日',
        isSummarized: false  // 标记为尚未浓缩
      };

      filteredList.push(newMemory);

      // 先保存完整报告
      st.saveChatSettings(chatId, { charMemoryList: filteredList }).then(function () {
        state.saved = true;
        var saveBtn = $('cp-health-save');
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg> 保存成功，浓缩中...';
        }
        toast('保存成功！正在后台浓缩报告...');

        // 后台调用AI浓缩报告
        callAIForSummary(state.lastReport, contact).then(function (summary) {
          // 浓缩完成，更新记忆内容
          try {
            var settings2 = st.getChatSettings(chatId);
            var memoryList2 = Array.isArray(settings2.charMemoryList) ? settings2.charMemoryList : [];

            var updatedList = memoryList2.map(function (mem) {
              if (mem && mem.id === memoryId) {
                return Object.assign({}, mem, {
                  content: summary,
                  isSummarized: true,
                  summarizedAt: Date.now()
                });
              }
              return mem;
            });

            st.saveChatSettings(chatId, { charMemoryList: updatedList }).then(function () {
              if (saveBtn) {
                saveBtn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg> 已保存到记忆';
              }
              toast('报告浓缩完成！已保存到健康档案');
            }).catch(function () {
              // 浓缩成功但保存失败，不影响已保存的完整报告
              if (saveBtn) {
                saveBtn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg> 已保存到记忆';
              }
            });
          } catch (e) {
            console.error('更新浓缩报告失败：', e);
            if (saveBtn) {
              saveBtn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg> 已保存到记忆';
            }
          }
        }).catch(function (err) {
          // 浓缩失败，保留完整报告
          console.error('AI浓缩报告失败：', err);
          if (saveBtn) {
            saveBtn.innerHTML = '<svg class="cp-health-save-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3h12v18l-6-4-6 4V3z"/></svg> 已保存到记忆';
          }
          toast('浓缩失败，已保存完整报告');
        });
      }).catch(function (err) {
        console.error('保存体检报告失败：', err);
        toast('保存失败：' + (err.message || '未知错误'));
      });
    } catch (err) {
      console.error('保存体检报告失败：', err);
      toast('保存失败：' + (err.message || '未知错误'));
    }
  }

  // 初始化事件监听
  function init() {
    // 入口卡片点击事件
    var entryBtn = $('cp-health-report-btn');
    if (entryBtn) {
      entryBtn.addEventListener('click', openHealthReport);
    }

    // 返回按钮点击事件
    var backBtn = $('cp-health-back');
    if (backBtn) {
      backBtn.addEventListener('click', closeHealthReport);
    }

    // 生成报告按钮点击事件
    var generateBtn = $('cp-health-generate');
    if (generateBtn) {
      generateBtn.addEventListener('click', generateReport);
    }

    // 保存报告按钮点击事件
    var saveBtn = $('cp-health-save');
    if (saveBtn) {
      saveBtn.addEventListener('click', saveReportToMemory);
    }
  }

  // 页面加载完成后初始化
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // 暴露全局方法
  global.miyaCoupleHealth = {
    open: openHealthReport,
    close: closeHealthReport,
    generate: generateReport
  };

})(window);
