import {
  idAutoBuyerFoundLog,
  idProgressAutobuyer,
} from "../elementIds.constants";
import { getValue, setValue } from "../services/repository";
import {
  formatString,
  getRandWaitTime,
  promisifyTimeOut,
  wait,
} from "./commonUtil";
import { getSellPriceFromFutBin, fetchPricesFromFutBinBulk } from "./futbinUtil";
import { writeToDebugLog, writeToLog } from "./logUtil";
import { sendPinEvents } from "./notificationUtil";
import { getBuyBidPrice, getSellBidPrice } from "./priceUtils";
import { buyPlayer } from "./purchaseUtil";
import { updateProfit } from "./statsUtil";
import { refreshActionStates } from "../handlers/autobuyerProcessor";
import { getUserPlatform } from "../utils/userUtil";
import { updateStats } from "../handlers/statsProcessor";




const sellBids = new Set();

export const watchListUtil = function (buyerSetting) {
  sendPinEvents("Transfer Targets - List View");

  return new Promise((resolve) => {
    services.Item.clearTransferMarketCache();

    services.Item.requestWatchedItems().observe(this, function (t, response) {
      let bidPrice = buyerSetting["idAbMaxBid"];
      let sellPrice = buyerSetting["idAbSellPrice"];

      const maxNewBidNumber = 10 - response.data.items.length;
      setValue("maxNewBidNumber", maxNewBidNumber);

      let activeItems = response.data.items.filter(function (item) {
        return item._auction && item._auction._tradeState === "active";
      });
      

      services.Item.refreshAuctions(activeItems).observe(
        this,
        function (t, refreshResponse) {
          services.Item.requestWatchedItems().observe(
            this,
            async function (t, watchResponse) {

              let refreshedActiveItems = response.data.items.filter(function (item) {
                return item._auction && item._auction._tradeState === "active";
              });
              writeToLog(
                `active watched count ${refreshedActiveItems.length} `,
                idAutoBuyerFoundLog
              );
              updateStats("watchActive", refreshedActiveItems.length);


              const isAutoBuyerActive = getValue("autoBuyerActive");
              const filterName = getValue("currentFilter");
              const bidItemsByFilter = getValue("filterBidItems") || new Map();
              const filterWatchList =
                bidItemsByFilter.get(filterName) || new Set();

              const userWatchItems = getValue("userWatchItems");
              if (isAutoBuyerActive && bidPrice) {
                let outBidItems = watchResponse.data.items.filter(function (
                  item
                ) {
                  return (
                    item._auction._bidState === "outbid" &&
                    (!filterName ||
                      filterWatchList.has(item._auction.tradeId)) &&
                    !userWatchItems.has(item._auction.tradeId) &&
                    item._auction._tradeState === "active"
                  );
                });

                let futbinPercentNew = getValue("futbinPercentNew");
                for (var i = 0; i < outBidItems.length; i++) {
                  const currentItem = outBidItems[i];
                  
                  let existingValue = getValue(currentItem.definitionId);
                  if (existingValue) {
                    let futbinPrice = existingValue.price;
                    if (!futbinPrice){
                      continue;
                    }
                    let calculatedPrice = roundOffPrice((futbinPrice * futbinPercentNew) / 100);
                    if (!calculatedPrice) {
                      writeToLog("skip >>> cant get futbin price", idAutoBuyerFoundLog);
                      continue;
                    }
                    if (bidPrice > calculatedPrice){
                      bidPrice = calculatedPrice;
                    }
                  }

                  if (currentItem._auction.expires > 30){
                    writeToLog("skip >>> expires > 30", idAutoBuyerFoundLog);
                    continue;
                  }

                  await tryBidItems(
                    currentItem,
                    bidPrice,
                    sellPrice,
                    buyerSetting
                  );
                }
              }

              //const useFutBinPrice = buyerSetting["idSellFutBinPrice"];
              if (
                isAutoBuyerActive) {
              // if (
              //   isAutoBuyerActive &&
              //   ((sellPrice && !isNaN(sellPrice)) || useFutBinPrice)
              // ) {
                let boughtItems = watchResponse.data.items.filter(function (
                  item
                ) {
                  // return (
                  //   item.getAuctionData().isWon() &&
                  //   (!filterName ||
                  //     filterWatchList.has(item._auction.tradeId)) &&
                  //   !userWatchItems.has(item._auction.tradeId) &&
                  //   !sellBids.has(item._auction.tradeId)
                  // );
                  return item.getAuctionData().isWon();
                });
                
                updateStats("watchWon", boughtItems.length);
                writeToLog("refreshedActiveItems:" +refreshedActiveItems.length, idAutoBuyerFoundLog);
                writeToLog("boughtItems:" +boughtItems.length, idAutoBuyerFoundLog);

                if (refreshedActiveItems.length === 0){
                  if (boughtItems.length > 0){
                    //not sell out yet-refresh translist
                    refreshActionStates(false, true, false);
                  }else{
                    //sold out go market
                    setValue("currentPage", 1);
                    refreshActionStates(false, false, true);
                  }
                }

                const playersId = new Set();
                for (let i = boughtItems.length - 1; i >= 0; i--) {
                  let player = boughtItems[i];
                  playersId.add(player.definitionId);
                }
                const playersIdArray = Array.from(playersId);
                const platform = getUserPlatform();
                let pricesJSON = await fetchPricesFromFutBinBulk(
                  playersIdArray.splice(0, 30),
                  platform
                );
                const maxRelistNumber = getValue("maxRelistNumber");
                let maxReLiNum = maxRelistNumber;
                writeToLog("maxReLiNum:" + maxReLiNum, idAutoBuyerFoundLog);
                for (let i = boughtItems.length - 1; i >= 0; i--) {
                  if (maxReLiNum < 1){
                    //maxRelistNumber = 0;
                    setValue("maxRelistNumber", 0);
                    //writeToLog("skip relist because transfer list if full", idAutoBuyerFoundLog);
                    continue;
                  }
                  
                  const player = boughtItems[i];
                  // const ratingThreshold = buyerSetting["idSellRatingThreshold"];
                  // let playerRating = parseInt(player.rating);
                  // const isValidRating =
                  //   !ratingThreshold || playerRating <= ratingThreshold;

                  // if (isValidRating && useFutBinPrice) {
                    // let playerName = formatString(player._staticData.name, 15);
                    // sellPrice = await getSellPriceFromFutBin(
                    //   buyerSetting,
                    //   playerName,
                    //   player
                    // );
                  // }
                  if (!pricesJSON[player.definitionId]) {
                    writeToLog("skip >>> (can not find futbin price)",idAutoBuyerFoundLog);
                    continue;
                  }
                  let futbinPrice = parseInt(pricesJSON[player.definitionId].prices[platform].LCPrice);
                  if (!futbinPrice||(futbinPrice==null)){
                    writeToLog("skip >>> cant get futbin price",idAutoBuyerFoundLog);
                    continue;
                  }
                  //get right sell price
                  let rightPrice = 500;
                  rightPrice = Math.max(rightPrice, futbinPrice);
                  //let playerJSON = JSON.stringify(player);
                  //writeToLog("playerJSON" + playerJSON,idAutoBuyerFoundLog);

                  if ((rightPrice * 0.95 - player._auction.currentBid) < 50){
                    rightPrice = player._auction.currentBid + 100;
                  }
                  sellPrice = rightPrice;
                  
                  // let existingValue = getValue(player.definitionId);
                  // if (existingValue) {
                  //   let futbinPrice = existingValue.price;
                  //   if (!futbinPrice){
                  //     continue;
                  //   }
                  //   sellPrice = futbinPrice;
                  // }
                  const shouldList = true;
                  // const checkBuyPrice = buyerSetting["idSellCheckBuyPrice"];
                  // if (checkBuyPrice && price > sellPrice) {
                  //   sellPrice = -1;
                  // }

                  // const shouldList =
                  //   sellPrice && !isNaN(sellPrice) && isValidRating;

                  if (sellPrice < 50) {
                    writeToLog("skip >>> can not get futbin price it is less than 50",idAutoBuyerFoundLog);
                    //services.Item.move(player, ItemPile.TRANSFER);
                  } else if (shouldList) {
                    updateProfit(sellPrice * 0.95 - player._auction.currentBid);
                    await sellWonItems(
                      player,
                      sellPrice,
                      buyerSetting["idAbWaitTime"]
                    );
                    maxReLiNum--;
                  } else {
                    //services.Item.move(player, ItemPile.CLUB);
                  }
                }
                setValue("maxRelistNumber", maxReLiNum);
              }
              

              let expiredItems = watchResponse.data.items.filter((item) => {
                var t = item.getAuctionData();
                return t.isExpired() || (t.isClosedTrade() && !t.isWon());
              });
              if (expiredItems.length) {
                await unWatchPlayers(expiredItems);
              }

              services.Item.clearTransferMarketCache();
              //start to search for new items
              let boughtItems = watchResponse.data.items.filter(function (
                item
              ) {
                return item.getAuctionData().isWon();
              });
              
              resolve();
            }
          );
        }
      );
    });
  });
};

async function unWatchPlayers(players){
  return new Promise((resolve) => {
    services.Item.untarget(players).observe(this, function(t, response){
      if (response.success){
        writeToLog(
          `Found ${players.length} expired items and removed from watchlist`,
          idAutoBuyerFoundLog
        );
      }else{
        writeToLog(
          `untarget ${players.length} failed`,
          idAutoBuyerFoundLog
        );
      }
      resolve();
    });
  });
}

export const addUserWatchItems = () => {
  return new Promise((resolve, reject) => {
    services.Item.requestWatchedItems().observe(this, function (t, response) {
      if (response.success) {
        const userWatchItems =
          response.data.items
            .filter((item) => item._auction)
            .map((item) => item._auction.tradeId) || [];

        setValue("userWatchItems", new Set(userWatchItems));

        if (userWatchItems.length) {
          writeToLog(
            `Found ${userWatchItems.length} items in users watch list and ignored from selling`,
            idAutoBuyerFoundLog
          );
        }
      }
      resolve();
    });
  });
};

const tryBidItems = async (player, bidPrice, sellPrice, buyerSetting) => {
  let auction = player._auction;
  let isBid = auction.currentBid;
  let currentBid = auction.currentBid || auction.startingBid;
  let playerName = formatString(player._staticData.name, 15);
  const isAutoBuyerActive = getValue("autoBuyerActive");

  let priceToBid = buyerSetting["idAbBidExact"]
    ? bidPrice
    : isBid
    ? getSellBidPrice(bidPrice)
    : bidPrice;

  let checkPrice = buyerSetting["idAbBidExact"]
    ? bidPrice
    : isBid
    ? getBuyBidPrice(currentBid)
    : currentBid;

  if (
    isAutoBuyerActive &&
    currentBid <= priceToBid
    // checkPrice <= window.futStatistics.coinsNumber
  ) {
    writeToLog(
      "Bidding on outbidded item -> Bidding Price :" + checkPrice,
      idAutoBuyerFoundLog
    );
    await buyPlayer(player, playerName, checkPrice, sellPrice);
    buyerSetting["idAbAddBuyDelay"] && (await wait(1));
  }else if (isAutoBuyerActive){
    //currentBid is highter than bid price--should untarget
    services.Item.untarget(player).observe(this, function(t, response){
      if (response.success){
        writeToLog(
          `one player bid price is too hight`,
          idAutoBuyerFoundLog
        );
      }else{
        writeToLog(
          `untarget one player failed`,
          idAutoBuyerFoundLog
        );
      }
    });
  }
};

const sellWonItems = async (player, sellPrice, waitRange) => {
  let auction = player._auction;
  let playerName = formatString(player._staticData.name, 15);
  sellBids.add(auction.tradeId);
  writeToLog(
    " ($$$) " +
      playerName +
      "[" +
      player._auction.tradeId +
      "] -- Selling for: " +
      sellPrice,
    idProgressAutobuyer
  );
  player.clearAuction();
  await wait(1);
  await promisifyTimeOut(function () {
    services.Item.list(player, getSellBidPrice(sellPrice), sellPrice, 3600);
  }, 0);
};
