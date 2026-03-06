import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";

export interface LeadContact {
  ContactName: string | null;
  ContactTitle: string | null;
  ContactEmail: string | null;
  ContactPhone: string | null;
  ContactRoleName: string | null;
}

export interface EmployeeLead {
  LeadId: number;
  CompanyName: string;
  CompanyLocation: string;
  LeadSource: string;
  LeadDate: string;       
  LeadNotes: string | null;
  StatusName: string | null;
  OwnerName: string | null;
  Contacts: LeadContact[];
}

interface EmployeesState {
  list: EmployeeLead[];
  loading: boolean;
  error: string | null;
}

/* -------------------- Initial State -------------------- */

const initialState: EmployeesState = {
  list: [],
  loading: false,
  error: null,
};

/* ------------------ Async Thunk (GET) ------------------ */
// Calls your Next.js route: /api/employees/leads

export const fetchEmployees = createAsyncThunk<
  EmployeeLead[],
  void,
  { rejectValue: string }
>("employees/fetchEmployees", async (_, { rejectWithValue }) => {
  try {
    const res = await fetch("/api/employees/leads");

    if (!res.ok) {
      return rejectWithValue("Failed to fetch employees");
    }

    const data = await res.json();
    return data as EmployeeLead[];
  } catch (err) {
    return rejectWithValue("Network error while fetching employees");
  }
});

/* --------------------- Slice --------------------- */

const employeesSlice = createSlice({
  name: "employees",
  initialState,
  reducers: {
    setEmployees(state, action: PayloadAction<EmployeeLead[]>) {
      state.list = action.payload;
    },
    addEmployee(state, action: PayloadAction<EmployeeLead>) {
      state.list.push(action.payload);
    },
    updateEmployee(state, action: PayloadAction<EmployeeLead>) {
      const idx = state.list.findIndex(
        (e) => e.LeadId === action.payload.LeadId
      );
      if (idx >= 0) {
        state.list[idx] = action.payload;
      }
    },
    removeEmployee(state, action: PayloadAction<number>) {
      state.list = state.list.filter((e) => e.LeadId !== action.payload);
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchEmployees.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(
        fetchEmployees.fulfilled,
        (state, action: PayloadAction<EmployeeLead[]>) => {
          state.loading = false;
          state.list = action.payload;
        }
      )
      .addCase(fetchEmployees.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Unknown error";
      });
  },
});

export const {
  setEmployees,
  addEmployee,
  updateEmployee,
  removeEmployee,
} = employeesSlice.actions;

export default employeesSlice.reducer;
