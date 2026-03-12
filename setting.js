const fs = require("fs");
const chalk = require('chalk');
const moment = require("moment-timezone");

global.PAKASIR_API_KEY = "0X5Oa9sSGcpsbVwMjeqhbeOnYVDFN9iB"
global.PAKASIR_PROJECT_SLUG = "webot"
//Setting
global.urlBot = 'https://t.me/ImpuraBot'
global.BOT_TOKEN = "8498533605:AAGR3kYuemo4AsO9KPg_kUMJc5TdhuEP4Zg" //Create bot here https://t.me/BotFather and get the bot token
global.BOT_NAME = "ImpuraBot, Bot Auto Order 24 Jam " //Your bot name
global.OWNER_ID = "8378554356" //Your id
global.OWNER_NAME = "Impura" //Your name
global.OWNER_NUMBER = "6281317391284" //Your Telegram number
global.OWNER = ["https://t.me/impuraid"] //Pastikan username sudah sesuai agar fitur khusus owner bisa di pakai
global.CHANNEL = "https://t.me/aiprem_info" //Your Telegram channel 

//Images
global.thumbnail = "./options/image/thumbnail.jpg"

/// Message
global.mess = {
  sukses: "Done🤗",
  admin: "Command ini hanya bisa digunakan oleh Admin Grup",
  botAdmin: "Bot Harus menjadi admin",
  owner: "Command ini hanya dapat digunakan oleh owner bot",
  prem: "Command ini khusus member premium",
  group: "Command ini hanya bisa digunakan di grup",
  private: "Command ini hanya bisa digunakan di Private Chat",
  wait: "⏳ Mohon tunggu sebentar...",
  error: {
    lv: "Link yang kamu berikan tidak valid",
    api: "Maaf terjadi kesalahan"
  }
}


let time = moment(new Date()).format('HH:mm:ss DD/MM/YYYY')
let file = require.resolve(__filename)
fs.watchFile(file, () => {
  fs.unwatchFile(file)
  console.log(chalk.greenBright(`[ ${BOT_NAME} ]  `) + time + chalk.cyanBright(` "${file}" Telah diupdate!`))
  delete require.cache[file]
  require(file)
})
