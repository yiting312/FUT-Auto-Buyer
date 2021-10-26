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
import { getSellPriceFromFutBin } from "./futbinUtil";
import { writeToLog } from "./logUtil";
import { sendPinEvents } from "./notificationUtil";
import { getBuyBidPrice, getSellBidPrice } from "./priceUtils";
import { buyPlayer } from "./purchaseUtil";
import { updateProfit } from "./statsUtil";
import { refreshActionStates } from "../handlers/autobuyerProcessor";


const sellBids = new Set();

export const watchListUtil = function (buyerSetting) {
  sendPinEvents("Transfer Targets - List View");

  return new Promise((resolve) => {
    services.Item.clearTransferMarketCache();

    services.Item.requestWatchedItems().observe(this, function (t, response) {
      let bidPrice = buyerSetting["idAbMaxBid"];
      let sellPrice = buyerSetting["idAbSellPrice"];

      let activeItems = response.data.items.filter(function (item) {
        return item._auction && item._auction._tradeState === "active";
      });

      //start to search for new items
      if (activeItems.length === 0){
      //if (activeItems.length === 0 && window.maxNewBidNumber > 0){//if activebid is 0 then buy new items
        refreshActionStates(false, true, false);
      }

      services.Item.refreshAuctions(activeItems).observe(
        this,
        function (t, refreshResponse) {
          services.Item.requestWatchedItems().observe(
            this,
            async function (t, watchResponse) {
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

                for (var i = 0; i < outBidItems.length; i++) {
                  const currentItem = outBidItems[i];
                  
                  let existingValue = getValue(currentItem.definitionId);
                  if (existingValue) {
                    let futbinPrice = existingValue.price;
                    if (!futbinPrice){
                      continue;
                    }
                    let calculatedPrice = roundOffPrice((funbinPrice * 65) / 100);
                    if (!calculatedPrice) {
                      logWrite("skip >>> cant get futbin price");
                      continue;
                    }
                    if (bidPrice > calculatedPrice){
                      bidPrice = calculatedPrice;
                    }
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
                  return (
                    item.getAuctionData().isWon() &&
                    (!filterName ||
                      filterWatchList.has(item._auction.tradeId)) &&
                    !userWatchItems.has(item._auction.tradeId) &&
                    !sellBids.has(item._auction.tradeId)
                  );
                });

                for (var i = 0; i < boughtItems.length; i++) {
                  const player = boughtItems[i];
                  const ratingThreshold = buyerSetting["idSellRatingThreshold"];
                  let playerRating = parseInt(player.rating);
                  const isValidRating =
                    !ratingThreshold || playerRating <= ratingThreshold;

                  if (isValidRating && useFutBinPrice) {
                    let playerName = formatString(player._staticData.name, 15);
                    sellPrice = await getSellPriceFromFutBin(
                      buyerSetting,
                      playerName,
                      player
                    );
                  }

                  const checkBuyPrice = buyerSetting["idSellCheckBuyPrice"];
                  if (checkBuyPrice && price > sellPrice) {
                    sellPrice = -1;
                  }

                  const shouldList =
                    sellPrice && !isNaN(sellPrice) && isValidRating;

                  if (sellPrice < 0) {
                    services.Item.move(player, ItemPile.TRANSFER);
                  } else if (shouldList) {
                    updateProfit(sellPrice * 0.95 - player._auction.currentBid);
                    await sellWonItems(
                      player,
                      sellPrice,
                      buyerSetting["idAbWaitTime"]
                    );
                  } else {
                    services.Item.move(player, ItemPile.CLUB);
                  }

                  //lyt sell logic
                  let existingValue = getValue(player.definitionId);
                  if (existingValue) {
                    let futbinPrice = existingValue.price;
                    if (!futbinPrice){
                      continue;
                    }
                    await sellWonItems(
                      player,
                      futbinPrice,
                      buyerSetting["idAbWaitTime"]
                    );
                  }
                }
              }

              let expiredItems = watchResponse.data.items.filter((item) => {
                var t = item.getAuctionData();
                return t.isExpired() || (t.isClosedTrade() && !t.isWon());
              });

              if (expiredItems.length) {
                services.Item.untarget(expiredItems);
                writeToLog(
                  `Found ${expiredItems.length} expired items and removed from watchlist`,
                  idAutoBuyerFoundLog
                );
              }
              

              services.Item.clearTransferMarketCache();
              resolve();
            }
          );
        }
      );
    });
  });
};

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

  await promisifyTimeOut(function () {
    services.Item.list(player, getSellBidPrice(sellPrice), sellPrice, 3600);
  }, 1000);
};
