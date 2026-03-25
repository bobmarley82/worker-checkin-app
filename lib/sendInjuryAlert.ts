type InjuryAlertParams = {
  workerName: string;
  jobName: string;
  injured: boolean;
  actionType: "sign-in" | "sign-out";
  timestamp: string;
};

export async function sendInjuryAlert({
  workerName,
  jobName,
  injured,
  actionType,
  timestamp,
}: InjuryAlertParams) {
  if (!injured) return;

  // Replace this with your actual email provider call
  console.log("SEND INJURY ALERT EMAIL", {
    workerName,
    jobName,
    actionType,
    timestamp,
  });
}