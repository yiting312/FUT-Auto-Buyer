import { idProgressAutobuyer } from "../elementIds.constants";
import { updateStats } from "../handlers/statsProcessor";
import { getValue, setValue } from "../services/repository";
import { writeToLog, writeToDebugLog} from "./logUtil";
import { sendPinEvents } from "./notificationUtil";

export const transferListUtil = function (relistUnsold, minSoldCount) {
  sendPinEvents("Transfer List - List View");
  return new Promise((resolve) => {
    services.Item.requestTransferItems().observe(this, function (t, response) {
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
      updateStats("unsoldItems", unsoldItems);

      //const shouldClearSold = soldItems >= minSoldCount;
      const shouldClearSold = true;
      relistUnsold = true;
      if (unsoldItems && relistUnsold) {
        services.Item.relistExpiredAuctions().observe(
          this,
          function (t, listResponse) {
            !shouldClearSold &&
              UTTransferListViewController.prototype.refreshList();
          }
        );
      }

      const activeTransfers = response.data.items.filter(function (item) {
        return item.getAuctionData().isSelling();
      }).length;
      updateStats("activeTransfers", activeTransfers);

      const availableItems = response.data.items.filter(function (item) {
        return item.getAuctionData().isInactive();
      }).length;

      updateStats("availableItems", availableItems);

      const userCoins = services.User.getUser().coins.amount;
      updateStats("coinsNumber", userCoins);
      updateStats("coins", userCoins.toLocaleString());

      if (shouldClearSold) {
        writeToLog(
          "[TRANSFER-LIST] > " + soldItems + " item(s) sold\n",
          idProgressAutobuyer
        );
        clearSoldItems(soldItemsOrigin);
        //UTTransferListViewController.prototype._clearSold();
      }
      resolve();
    });
  });
};

const clearSoldItems = async (soldItems) => {
  services.Item.clearSoldItems().observe(this, function (t, response) {
      if (response.success){
        writeToLog(
          `clearSoldItems success`,
          idAutoBuyerFoundLog
        );
        //refresh clear sor
        services.Item.refreshAuctions(soldItems).observe(this, function (t, refreshResponse) {});
      }else{
        writeToLog(
          `clearSoldItems fail`,
          idAutoBuyerFoundLog
        );
      }
  });
};
