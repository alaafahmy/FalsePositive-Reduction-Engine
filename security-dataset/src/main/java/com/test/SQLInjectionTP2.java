package com.test;

/**
 * Classification  : TRUE POSITIVE
 * Vulnerability   : SQL Injection — indirect / multi-step flow (CWE-089)
 * Why vulnerable  : The raw user value is stored in a helper object and then
 *                   extracted and concatenated into SQL.  The indirection may
 *                   fool naive scanners that only trace single-step flows,
 *                   but the taint path is still complete.
 * CodeQL expected : SHOULD DETECT  (java/sql-injection)
 */
import java.io.IOException;
import java.io.PrintWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.ResultSet;
import java.sql.Statement;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;

public class SQLInjectionTP2 extends HttpServlet {

    // Simple carrier — does NOT sanitise, just stores the string
    static class SearchFilter {
        private final String field;
        private final String value;

        SearchFilter(String field, String value) {
            this.field = field;
            this.value = value;
        }

        String toSqlClause() {
            // Taint propagates through this method — value is still user input
            return field + " = '" + value + "'";
        }
    }

    @Override
    protected void doGet(HttpServletRequest req, HttpServletResponse resp)
            throws ServletException, IOException {

        // SOURCE
        String orderStatus = req.getParameter("status");

        // Taint stored in helper object
        SearchFilter filter = new SearchFilter("status", orderStatus);

        PrintWriter out = resp.getWriter();
        try {
            Connection conn = DriverManager.getConnection(
                    "jdbc:mysql://localhost:3306/appdb", "root", "secret");
            Statement stmt = conn.createStatement();

            // SINK — taint extracted from helper object
            String sql = "SELECT * FROM orders WHERE " + filter.toSqlClause();
            ResultSet rs = stmt.executeQuery(sql);

            while (rs.next()) {
                out.println(rs.getString("order_id"));
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }
}
