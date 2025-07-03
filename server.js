require('dotenv').config();
var express     = require('express');
var TelegramBot = require('node-telegram-bot-api');
var axios       = require('axios');
var db          = require('./db');

var app         = express();
app.use(express.json());
var bot         = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
var sessions    = {};    // chatId → { action }
var claimed     = {};    // referral credit tracker

// ── Notify Admin via DM ───────────────────────────────────────────
function notifyAdmin(req) {
  var txt =
    '🔔 New Request #' + req.req_id +
    '\nUser: ' + req.user_id +
    '\nType: ' + req.type +
    '\nAmount: ₦' + req.amount +
    (req.details ? '\nDetails: ' + req.details : '');
  var opts = {
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Approve', callback_data: 'approve_' + req.req_id },
        { text: '❌ Reject',  callback_data: 'reject_'  + req.req_id }
      ]]
    }
  };
  bot.sendMessage(process.env.ADMIN_CHATID, txt, opts);
}

// ── Start Command with Referral ───────────────────────────────────
bot.onText(/\/start(?: (\d+))?/, function(msg, match) {
  var chatId = String(msg.chat.id);
  var refId  = match[1];
  if (refId && refId !== chatId && !claimed[chatId]) {
    db.updateBalance(chatId, 100, function(){});
    db.updateBalance(refId, 100, function(){});
    claimed[chatId] = true;
    bot.sendMessage(chatId, '🎉 Referral credited! You and your referrer got ₦100.');
  }
  bot.sendMessage(chatId, '🤖 Welcome to Naija Utility Bot!', {
    reply_markup: {
      keyboard: [
        ['Balance', 'Withdraw'],
        ['Referral','Buy Data'],
        ['Buy Airtime','Chat with AI'],
        ['Add Funds']
      ],
      resize_keyboard: true
    }
  });
});

// ── Message Handler ───────────────────────────────────────────────
bot.on('message', function(msg) {
  var chatId = String(msg.chat.id);
  var text   = msg.text && typeof msg.text === 'string' ? msg.text.trim() : '';
  var sess   = sessions[chatId] || {};
  if (!text || text.charAt(0)==='/') return;

  // Add Funds
  if (text === 'Add Funds') {
    sessions[chatId] = { action:'addfund' };
    return bot.sendMessage(chatId, 'Enter amount to ADD:');
  }
  if (sess.action === 'addfund') {
    var amt = parseInt(text,10); delete sessions[chatId];
    if (isNaN(amt)||amt<=0) return bot.sendMessage(chatId, '❌ Invalid.');
    db.logRequest(chatId, 'addfund', amt, '', function() {
      db.getPendingRequests(function(_, all){ notifyAdmin(all[0]); });
    });
    return bot.sendMessage(chatId, '💸 Request logged.');
  }

  // Balance
  if (text === 'Balance') {
    db.getBalance(chatId, function(bal) {
      bot.sendMessage(chatId, '💰 Your balance: ₦' + bal);
    });
    return;
  }

  // Referral
  if (text === 'Referral') {
    var link = 'https://t.me/' + process.env.BOT_USERNAME + '?start=' + chatId;
    return bot.sendMessage(chatId, '🔗 Share & earn ₦100:\n' + link);
  }

  // Withdraw
  if (text === 'Withdraw') {
    sessions[chatId] = { action:'withdraw' };
    return bot.sendMessage(chatId,'Enter amount to WITHDRAW:');
  }
  if (sess.action === 'withdraw') {
    var amt = parseInt(text,10); delete sessions[chatId];
    db.getBalance(chatId,function(bal){
      if (isNaN(amt)||amt<=0||bal<amt) return bot.sendMessage(chatId,'❌ Invalid or insufficient.');
      db.logRequest(chatId,'withdraw',amt,'',function(){
        db.getPendingRequests(function(_,all){ notifyAdmin(all[0]); });
      });
      bot.sendMessage(chatId,'🚨 Withdraw request logged.');
    });
    return;
  }

  // Buy Data
  if (text === 'Buy Data') {
    sessions[chatId] = { action:'data' };
    return bot.sendMessage(chatId,'Enter: <amount> <phone>');
  }
  if (sess.action === 'data') {
    var p = text.split(/\s+/); delete sessions[chatId];
    var amt = parseInt(p[0],10), ph = p[1];
    if (isNaN(amt)||!ph) return bot.sendMessage(chatId,'❌ Invalid.');
    db.logRequest(chatId,'data',amt,ph,function(){
      db.getPendingRequests(function(_,all){ notifyAdmin(all[0]); });
    });
    return bot.sendMessage(chatId,'📡 Data request logged.');
  }

  // Buy Airtime
  if (text === 'Buy Airtime') {
    sessions[chatId] = { action:'airtime' };
    return bot.sendMessage(chatId,'Enter: <amount> <phone>');
  }
  if (sess.action === 'airtime') {
    var p = text.split(/\s+/); delete sessions[chatId];
    var amt = parseInt(p[0],10), ph = p[1];
    if (isNaN(amt)||!ph) return bot.sendMessage(chatId,'❌ Invalid.');
    db.logRequest(chatId,'airtime',amt,ph,function(){
      db.getPendingRequests(function(_,all){ notifyAdmin(all[0]); });
    });
    return bot.sendMessage(chatId,'📞 Airtime request logged.');
  }

  // AI chat
  if (text === 'Chat with AI') {
    sessions[chatId] = { action:'ai' };
    return bot.sendMessage(chatId,'Send your question:');
  }
  if (sess.action === 'ai') {
    delete sessions[chatId]; bot.sendMessage(chatId,'🤖 Thinking…');
    axios.post(
      'https://api.openrouter.ai/v1/chat/completions',
      {
        model: 'gpt-3.5-turbo',
        messages: [{ role:'user', content:text }]
      },
      {
        headers: {
          Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY
        }
      }
    ).then(function(resp){
      var reply = resp.data.choices[0].message.content;
      bot.sendMessage(chatId, reply || '❌ No reply');
    }).catch(function(){
      bot.sendMessage(chatId,'❌ AI Error');
    });
  }
});

// ── Handle Approve/Reject Buttons ────────────────────────────────
bot.on('callback_query', function(cbq){
  var data = cbq.data;
  var reqId = parseInt(data.split('_')[1], 10);
  var act   = data.startsWith('approve') ? 'approve' : 'reject';

  db.setRequestStatus(reqId, act, function() {
    db.getRequest(reqId, function(err, r){
      if (!err && r) {
        if (act==='approve') {
          var delta = r.type==='withdraw' ? -r.amount : r.amount;
          db.updateBalance(r.user_id, delta, function(){});
        }
        bot.sendMessage(r.user_id,
          '🔔 Your request #' + reqId + ' ('+r.type+') ₦' + r.amount +
          ' has been ' + act + 'd.'
        );
        bot.answerCallbackQuery(cbq.id, { text: '✅ ' + act + 'd' });
      }
    });
  });
});

// ── Web Health ───────────────────────────────────────────────────
app.get('/', function(req,res){
  res.send('🚀 Naija Utility Bot is online');
});
app.listen(process.env.PORT||3000);
