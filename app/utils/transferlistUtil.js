import { idProgressAutobuyer,idAutoBuyerFoundLog } from "../elementIds.constants";
import { updateStats } from "../handlers/statsProcessor";
import { getValue, setValue } from "../services/repository";
import { writeToLog, writeToDebugLog} from "./logUtil";
import { sendPinEvents } from "./notificationUtil";
import {
  formatString,
  promisifyTimeOut,
} from "./commonUtil";
import { getSellPriceFromFutBin, fetchPricesFromFutBinBulk } from "./futbinUtil";
import { getUserPlatform } from "../utils/userUtil";
import { getBuyBidPrice, getSellBidPrice } from "./priceUtils";
import { refreshActionStates } from "../handlers/autobuyerProcessor";





export const transferListUtil = function (relistUnsold, minSoldCount) {
  sendPinEvents("Transfer List - List View");
  writeToLog("transferListUtil", idAutoBuyerFoundLog);
  return new Promise((resolve) => {
    services.Item.requestTransferItems().observe(this, async function (t, response) {
      writeToLog("transferListUtil response.data.items.length:" + response.data.items.length, idAutoBuyerFoundLog);

      var maxRelistNumber = getValue("maxRelistNumber");
      maxRelistNumber = 100 - response.data.items.length;
      setValue("maxRelistNumber", maxRelistNumber);
      let soldItems = response.data.items.filter(function (item) {
        return item.getAuctionData().isSold();
      }).length;
      let soldItemsOrigin = response.data.items.filter(function (item) {
        return item.getAuctionData().isSold();
      });
      updateStats("soldItems", soldItems);

      const unsoldItems = response.data.items.filter(function (item) {
        return (
          !item.getAuctionData().isSold() && item.getAuctionData().isExpired()
        );
      }).length;
      const unsoldItemsOrigin = response.data.items.filter(function (item) {
        return (
          !item.getAuctionData().isSold() && item.getAuctionData().isExpired()
        );
      });
      updateStats("unsoldItems", unsoldItems);

      const shouldClearSold = soldItems > 0;
      //const shouldClearSold = true;
      relistUnsold = true;
      // if (unsoldItems && relistUnsold) {
      //   services.Item.relistExpiredAuctions().observe(
      //     this,
      //     function (t, listResponse) {
      //       // !shouldClearSold &&
      //       //   UTTransferListViewController.prototype.refreshList();
      //     }
      //   );
      // }
      writeToLog("unsoldItems:" + unsoldItems, idAutoBuyerFoundLog);
      //if (unsoldItems && relistUnsold){
      if (unsoldItems){
        // const playersId = new Set();
        // for (let i = unsoldItems - 1; i >= 0; i--) {
        //   let player = unsoldItemsOrigin[i];
        //   playersId.add(player.definitionId);
        // }
        // const platform = getUserPlatform();
        // const playersIdArray = Array.from(playersId);
        // let pricesJSON = await fetchPricesFromFutBinBulk(
        //   playersIdArray.splice(0, 30),
        //   platform
        // );

        
        // for (let i = unsoldItems - 1; i >= 0; i--) {
        //   let sellPrice = 0;
        //   const player = unsoldItemsOrigin[i];
        //   if (!pricesJSON[player.definitionId]) {
        //     //writeToLog("skip >>> (can not find futbin price)",idAutoBuyerFoundLog);
        //     continue;
        //   }
        //   let funbinPrice = parseInt(pricesJSON[player.definitionId].prices[platform].LCPrice);
        //   if (!funbinPrice || (funbinPrice == null)) {
        //     //writeToLog("skip >>> cant get futbin price",idAutoBuyerFoundLog);
        //     continue;
        //   }
        //   sellPrice = funbinPrice;
        //   const shouldList = true;
        //   if (sellPrice < 0) {
        //     //services.Item.move(player, ItemPile.TRANSFER);
        //   } else if (shouldList) {
        //     await sellWonItems(
        //       player,
        //       sellPrice
        //     );
        //   } else {
        //     //services.Item.move(player, ItemPile.CLUB);
        //   }
        // }
        await relistExpiredItemsWithoutChange(unsoldItemsOrigin);

        //await relistExpiredItemsWithoutChangeOneByOne(unsoldItemsOrigin);
      }

      const activeTransfers = response.data.items.filter(function (item) {
        return item.getAuctionData().isSelling();
      }).length;
      updateStats("activeTransfers", activeTransfers);


      //sell available item
      const availableItems = response.data.items.filter(function (item) {
        return item.getAuctionData().isInactive();
      }).length;
      const availableItemsOrigin = response.data.items.filter(function (item) {
        return item.getAuctionData().isInactive();
      });
      updateStats("availableItems", availableItems);
      
      if (availableItems){
        const playersId = new Set();
        for (let i = availableItems - 1; i >= 0; i--) {
          let player = availableItemsOrigin[i];
          playersId.add(player.definitionId);
        }
        const platform = getUserPlatform();
        const playersIdArray = Array.from(playersId);
        let pricesJSON = await fetchPricesFromFutBinBulk(
          playersIdArray.splice(0, 30),
          platform
        );

        
        for (let i = availableItems - 1; i >= 0; i--) {
          if (i != (availableItems - 1)){
            continue;
          }
          let sellPrice = 0;
          const player = availableItemsOrigin[i];
          if (!pricesJSON[player.definitionId]) {
            //writeToLog("skip >>> (can not find futbin price)",idAutoBuyerFoundLog);
            continue;
          }
          let funbinPrice = parseInt(pricesJSON[player.definitionId].prices[platform].LCPrice);
          if (!funbinPrice || (funbinPrice == null)) {
            //writeToLog("skip >>> cant get futbin price",idAutoBuyerFoundLog);
            continue;
          }
          let rightPrice = 500;
          rightPrice = Math.max(rightPrice, funbinPrice);
          if ((rightPrice * 0.95 - player.lastSalePrice) < 50) {
            rightPrice = player.lastSalePrice + 100;
          }
          sellPrice = rightPrice;
          
          //sellPrice = funbinPrice;
          const shouldList = true;
          if (sellPrice < 0) {
            //services.Item.move(player, ItemPile.TRANSFER);
          } else if (shouldList) {
            await sellWonItems(
              player,
              sellPrice
            );
          } else {
          }
        }
      }
      

      const userCoins = services.User.getUser().coins.amount;
      updateStats("coinsNumber", userCoins);
      updateStats("coins", userCoins.toLocaleString());

      if (shouldClearSold) {
        writeToLog(
          "[TRANSFER-LIST] > " + soldItems + " item(s) sold\n",
          idProgressAutobuyer
        );
        await clearSoldItems(soldItemsOrigin);
        //UTTransferListViewController.prototype._clearSold();
      }

      //decide where to go 
      //if (shouldClearSold && (response.data.items.length == 100)){
      if (shouldClearSold){
        //stay in transfer list
        refreshActionStates(false, true, false);
      }else{
        //go to market
        setValue("currentPage", 1);
        refreshActionStates(false, false, true);
      }
      resolve();
    });
  });
};

const relistExpiredItemsWithoutChangeOneByOne = (unsoldItemsOrigin) =>{
  return new Promise ((resolve)=>{
    setValue("lock", true);
    let listNum = 1;
    for (let i = 0; i < unsoldItemsOrigin.length; i++){
      let playerX = unsoldItemsOrigin[i];
      let needLock = true;
      if (i === unsoldItemsOrigin.length - 1){
        needLock = false;
      }
      sellOneWithoutChange(listNum, playerX, needLock);
      if (i === unsoldItemsOrigin.length - 1){
        resolve();
      }
      listNum++;
    }
  });
}

const sellOneWithoutChange = function (listNum, playerX, needLock) {
  setTimeout(function () {
    let player_nameX = formatString(playerX._staticData.name, 15);
    let sellPriceX = playerX._auction.buyNowPrice;
    writeToLog("relist  |  " + player_nameX + "  |  " + sellPriceX + "  |  " + listNum, idAutoBuyerFoundLog);
    services.Item.list(playerX, getSellBidPrice(sellPriceX), sellPriceX, 3600);
    if (!needLock){
      //should release the lock
      setValue("lock", false);
    }
  }, 2000 * listNum);	// 还是每秒执行一次，不是累加的
}

const relistExpiredItemsWithoutChange = (unsoldItemsOrigin) => {
  return new Promise((resolve)=>{
    services.Item.relistExpiredAuctions().observe(
      this, function (t, response) {
        if (response.success) {
          writeToLog("relistExpiredAuctions success:", idAutoBuyerFoundLog);
          //UTTransferListViewController.prototype.refreshList();
          //services.Item.refreshAuctions(unsoldItemsOrigin).observe(this, function (t, refreshResponse) { });
        } else {
          writeToLog("relistExpiredAuctions fail:", idAutoBuyerFoundLog);
        }
        resolve();
      }
    );
  });
};

const clearSoldItems = (soldItems) => {
  return new Promise((resolve)=>{
    services.Item.clearSoldItems().observe(this, function (t, response) {
      if (response.success) {
        writeToLog(
          `clearSoldItems success`,
          idProgressAutobuyer
        );
        //refresh clear sor
        services.Item.refreshAuctions(soldItems).observe(this, function (t, refreshResponse) { });
      } else {
        writeToLog(
          `clearSoldItems fail`,
          idProgressAutobuyer
        );
      }
      resolve();
    });
  });
  
};

const sellWonItems = async (player, sellPrice) => {
  let auction = player._auction;
  let playerName = formatString(player._staticData.name, 15);
  writeToLog(
    " ($$$) " +
      playerName +
      "[" +
      player._auction.tradeId +
      "] -- Selling for: " +
      sellPrice,
      idAutoBuyerFoundLog
  );
  player.clearAuction();

  await promisifyTimeOut(function () {
    services.Item.list(player, getSellBidPrice(sellPrice), sellPrice, 3600);
  }, 1000);
};
