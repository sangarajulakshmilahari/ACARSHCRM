import { configureStore } from "@reduxjs/toolkit";
import userReducer from "./userSlice";
import employeesReducer from "./employeesSlice";


export const store = configureStore({
  reducer: {
    user: userReducer,
    employees: employeesReducer
  }
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
